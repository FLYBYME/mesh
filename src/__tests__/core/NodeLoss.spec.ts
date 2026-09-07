import { Registry } from '../../core/Registry.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import type { NodeInfo } from '../../interfaces/IMeshNetwork.js';
import { WSTransport } from '../../transports/node/WSTransport.js';
import { JSONSerializer } from '../../serializers/JSONSerializer.js';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'node:http';
import { MeshNetwork } from '../../core/MeshNetwork.js';

jest.mock('ws');
jest.mock('node:http');

describe('Node Loss Detection Timing', () => {
    let logger: Logger;

    const createNodeInfo = (nodeID: string): NodeInfo => ({
        nodeID,
        type: 'node',
        namespace: 'default',
        addresses: [],
        available: true,
        timestamp: Date.now(),
        nodeSeq: 1,
        hostname: 'localhost',
        services: [],
        trustLevel: 'internal',
        metadata: {},
        capabilities: { transports: ['ws'], features: [] },
        pid: process.pid,
        cpu: 0,
        activeRequests: 0,
        healthScore: 1.0
    });

    const createMockWS = () => {
        const listeners: Record<string, ((...args: any[]) => void)[]> = {};
        const mock = {
            on: jest.fn((event: string, cb: (...args: any[]) => void) => {
                listeners[event] = listeners[event] || [];
                listeners[event].push(cb);
            }),
            once: jest.fn(),
            send: jest.fn(),
            close: jest.fn(() => {
                (listeners['close'] || []).forEach(cb => cb());
            }),
            terminate: jest.fn(() => {
                (listeners['close'] || []).forEach(cb => cb());
            }),
            readyState: 1,
            ping: jest.fn(),
            bufferedAmount: 0,
            emitMockEvent: (event: string, ...args: any[]) => {
                (listeners[event] || []).forEach(cb => cb(...args));
            }
        };
        return mock;
    };

    const createMockServer = () => ({
        listen: jest.fn((...args: any[]) => {
            const cb = args[args.length - 1];
            if (typeof cb === 'function') cb();
        }),
        address: jest.fn(() => ({ port: 5005 })),
        on: jest.fn(),
        close: jest.fn((cb: () => void) => cb && cb())
    });

    beforeEach(() => {
        logger = new Logger(LogLevel.ERROR);
        jest.mocked(WebSocketServer).mockClear();
        jest.mocked(WebSocket).mockClear();
        jest.mocked(http.createServer).mockClear();
        jest.mocked(http.createServer).mockReturnValue(createMockServer() as any);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('Registry Sweep & Liveness Backstop', () => {
        it('preserves default Registry sweep detecting dead node at 35s (30s ttl + 5s sweep)', async () => {
            jest.useFakeTimers();
            const registry = new Registry(logger, { localNodeID: 'local-node' });
            const remote = createNodeInfo('remote-dead');
            registry.registerNode(remote);
            await registry.start();

            expect(registry.getNode('remote-dead')?.available).toBe(true);

            // At 30 seconds (TTL elapsed), sweep ran at 30s but age (30000) is not > ttlMs (30000)
            jest.advanceTimersByTime(30000);
            expect(registry.getNode('remote-dead')?.available).toBe(true);

            // At 34.999s, next sweep has not run yet
            jest.advanceTimersByTime(4999);
            expect(registry.getNode('remote-dead')?.available).toBe(true);

            // At 35 seconds, the 5s sweep runs and age (35000) > 30000 -> marked offline
            jest.advanceTimersByTime(1);
            expect(registry.getNode('remote-dead')?.available).toBe(false);

            // Node is still in registry (not yet deleted)
            expect(registry.getNode('remote-dead')).toBeDefined();

            // Node is only deleted at 65s (age > 2 * 30000 on the 5s sweep)
            jest.advanceTimersByTime(29999);
            expect(registry.getNode('remote-dead')).toBeDefined();
            jest.advanceTimersByTime(1);
            expect(registry.getNode('remote-dead')).toBeUndefined();

            await registry.stop();
        });

        it('derives sweep interval from ttl so ttl: 2000 observes unavailable before deletion', async () => {
            jest.useFakeTimers();
            // With ttl: 2000, pruneInterval defaults to Math.floor(2000 / 2) = 1000ms
            const registry = new Registry(logger, { localNodeID: 'local-node', ttl: 2000 });
            const remote = createNodeInfo('remote-dead-2');
            registry.registerNode(remote);
            await registry.start();

            expect(registry.getNode('remote-dead-2')?.available).toBe(true);

            // At 2000ms, age is 2000 (not > 2000), still available
            jest.advanceTimersByTime(2000);
            expect(registry.getNode('remote-dead-2')?.available).toBe(true);

            // At 3000ms (next 1000ms sweep), age is 3000 > 2000, but 3000 < 4000 (2 * ttl)
            // It is marked unavailable, NOT deleted!
            jest.advanceTimersByTime(1000);
            expect(registry.getNode('remote-dead-2')?.available).toBe(false);
            expect(registry.getNode('remote-dead-2')).toBeDefined();

            // At 5000ms (next sweep where age 5000 > 4000), it is deleted
            jest.advanceTimersByTime(2000);
            expect(registry.getNode('remote-dead-2')).toBeUndefined();

            await registry.stop();
        });

        it('heartbeat brings an unavailable node back before deletion threshold', async () => {
            jest.useFakeTimers();
            const registry = new Registry(logger, { localNodeID: 'local-node', ttl: 2000 });
            const remote = createNodeInfo('flapping-node');
            registry.registerNode(remote);
            await registry.start();

            // At 3000ms, node is marked unavailable
            jest.advanceTimersByTime(3000);
            expect(registry.getNode('flapping-node')?.available).toBe(false);

            // Heartbeat arrives at 3500ms (proof of life)
            registry.heartbeat('flapping-node');
            expect(registry.getNode('flapping-node')?.available).toBe(true);

            // Advance another 2000ms (to 5500ms total, but only 2000ms since heartbeat)
            jest.advanceTimersByTime(2000);
            // Node is still available and NOT deleted
            expect(registry.getNode('flapping-node')?.available).toBe(true);

            await registry.stop();
        });
    });

    describe('Transport-level fast detection via WebSocket ping/pong', () => {
        it('detects an uncleanly killed socket within 2 seconds using ping/pong timeout', async () => {
            jest.useFakeTimers();
            const serializer = new JSONSerializer();
            // Configure fast detection: 1s ping interval, 1s ping timeout
            const transport = new WSTransport(serializer, 5005, '0.0.0.0', {
                pingIntervalMs: 1000,
                pingTimeoutMs: 1000
            });
            transport.logger = logger;

            const mockWS = createMockWS();
            jest.mocked(WebSocket).mockReturnValue(mockWS as any);

            await transport.connect({ nodeID: 'local-node', namespace: 'default', url: '', logger });

            let peerDisconnected = false;
            transport.on('peer:disconnect', (id) => {
                if (id === 'peer-dead') peerDisconnected = true;
            });

            const connectPromise = transport.connectToPeer('peer-dead', 'ws://peer:5005');
            mockWS.emitMockEvent('open');
            await connectPromise;

            expect(mockWS.ping).not.toHaveBeenCalled();
            expect(peerDisconnected).toBe(false);

            // At 1000ms: ping is sent, awaiting pong
            jest.advanceTimersByTime(1000);
            expect(mockWS.ping).toHaveBeenCalledTimes(1);
            expect(peerDisconnected).toBe(false);

            // The peer is dead (unclean loss: no close frame sent, no pong returned).
            // At 2000ms (1000ms timeout expired): transport terminates socket
            jest.advanceTimersByTime(1000);
            expect(mockWS.terminate).toHaveBeenCalled();
            expect(peerDisconnected).toBe(true);

            await transport.disconnect();
        });

        it('keeps connection alive when peer answers ping with pong', async () => {
            jest.useFakeTimers();
            const serializer = new JSONSerializer();
            const transport = new WSTransport(serializer, 5005, '0.0.0.0', {
                pingIntervalMs: 1000,
                pingTimeoutMs: 1000
            });
            transport.logger = logger;

            const mockWS = createMockWS();
            jest.mocked(WebSocket).mockReturnValue(mockWS as any);

            await transport.connect({ nodeID: 'local-node', namespace: 'default', url: '', logger });
            const connectPromise = transport.connectToPeer('peer-healthy', 'ws://peer:5005');
            mockWS.emitMockEvent('open');
            await connectPromise;

            // Ping 1 sent at 1000ms
            jest.advanceTimersByTime(1000);
            expect(mockWS.ping).toHaveBeenCalledTimes(1);

            // Healthy peer responds with pong at 1100ms
            jest.advanceTimersByTime(100);
            mockWS.emitMockEvent('pong');

            // Advance to 1900ms (before ping 2)
            jest.advanceTimersByTime(800);
            // Socket was NOT terminated because pong was received!
            expect(mockWS.terminate).not.toHaveBeenCalled();

            // Next ping at 2000ms
            jest.advanceTimersByTime(100);
            expect(mockWS.ping).toHaveBeenCalledTimes(2);

            // Answer ping 2 at 2050ms
            jest.advanceTimersByTime(50);
            mockWS.emitMockEvent('pong');

            // Advance further - socket stays alive
            jest.advanceTimersByTime(800);
            expect(mockWS.terminate).not.toHaveBeenCalled();

            await transport.disconnect();
        });

        it('full chain: unclean socket loss unregisters dead node from registry within 2 seconds', async () => {
            jest.useFakeTimers();
            const registry = new Registry(logger, { localNodeID: 'local-node' });
            await registry.start();

            const serializer = new JSONSerializer();
            const transport = new WSTransport(serializer, 5005, '0.0.0.0', {
                pingIntervalMs: 1000,
                pingTimeoutMs: 1000
            });
            transport.logger = logger;

            const network = new MeshNetwork({
                nodeId: 'local-node',
                namespace: 'default',
                transports: [transport]
            }, logger, registry);

            const mockWS = createMockWS();
            jest.mocked(WebSocket).mockReturnValue(mockWS as any);

            await network.start();

            // Register peer in registry
            const deadNode = createNodeInfo('peer-dead');
            registry.registerNode(deadNode);
            expect(registry.getNode('peer-dead')?.available).toBe(true);

            // Connect to peer
            const connectPromise = network.connectToPeer('peer-dead', 'ws://peer:5005');
            mockWS.emitMockEvent('open');
            await connectPromise;

            // At 1000ms: ping 1 sent, still registered
            jest.advanceTimersByTime(1000);
            expect(registry.getNode('peer-dead')).toBeDefined();

            // At 2000ms (timeout expires without pong):
            // Transport terminates socket, emits peer:disconnect,
            // MeshOrchestrator unregisters node from Registry immediately!
            jest.advanceTimersByTime(1000);
            expect(registry.getNode('peer-dead')).toBeUndefined();

            await network.stop();
            await registry.stop();
        });
    });
});
