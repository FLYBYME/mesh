import { MeshNetwork } from '../../core/MeshNetwork.js';
import { MockTransport } from '../../transports/MockTransport.js';
import { JSONSerializer } from '../../serializers/JSONSerializer.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { IServiceRegistry } from '../../interfaces/IServiceRegistry.js';
import { MeshPacket } from '../../interfaces/IMeshNetwork.js';

describe('MeshNetwork', () => {
    let network: MeshNetwork;
    let transport: MockTransport;
    let registry: IServiceRegistry;
    let logger: Logger;
    const nodeID = 'test-node';

    beforeEach(() => {
        logger = new Logger(LogLevel.ERROR);
        
        // Satisfy the full IServiceRegistry interface without casting
        registry = {
            registerNode: jest.fn(),
            unregisterNode: jest.fn(),
            getNode: jest.fn(),
            getNodes: jest.fn(),
            getAvailableNodes: jest.fn(),
            heartbeat: jest.fn(),
            selectNode: jest.fn(),
            registerModule: jest.fn(),
            unregisterModule: jest.fn(),
            waitForService: jest.fn(),
            waitForNodes: jest.fn(),
            findNodesForTool: jest.fn(),
            waitForTool: jest.fn(),
            getNextToolEndpoint: jest.fn(),
            registerTool: jest.fn(),
            getTool: jest.fn(),
            getTools: jest.fn(),
            getModule: jest.fn(),
            listModules: jest.fn(),
            on: jest.fn(),
            off: jest.fn(),
            emit: jest.fn(),
            stop: jest.fn(),
            start: jest.fn()
        };

        transport = new MockTransport(new JSONSerializer());
        // Strongly type the mocks
        transport.send = jest.fn().mockResolvedValue(undefined);
        transport.publish = jest.fn().mockResolvedValue(undefined);

        network = new MeshNetwork({
            nodeId: nodeID,
            namespace: 'test-ns',
            transports: [transport]
        }, logger, registry);
    });

    afterEach(async () => {
        await network.stop();
    });

    // ─── inbound logic ───────────────────────────────────────────────────────

    describe('Inbound Packet Handling', () => {
        it('should drop packets from self (loopback suppression)', async () => {
            const spy = jest.spyOn(network.dispatcher, 'dispatch');
            const packet: MeshPacket = {
                id: 'p1',
                topic: 'test',
                data: {},
                senderNodeID: nodeID, // from self
                type: 'EVENT',
                timestamp: Date.now(),
                version: 1,
                priority: 1,
                meta: {}
            };

            transport.emit('packet', packet);
            await new Promise(resolve => setTimeout(resolve, 20));
            expect(spy).not.toHaveBeenCalled();
        });

        it('should drop packets from different namespaces', async () => {
            const spy = jest.spyOn(network.dispatcher, 'dispatch');
            const packet: MeshPacket = {
                id: 'p1',
                topic: 'test',
                data: {},
                senderNodeID: 'other-node',
                namespace: 'wrong-ns',
                type: 'EVENT',
                timestamp: Date.now(),
                version: 1,
                priority: 1,
                meta: {}
            };

            transport.emit('packet', packet);
            await new Promise(resolve => setTimeout(resolve, 20));
            expect(spy).not.toHaveBeenCalled();
        });

        it('should deduplicate packets by ID', async () => {
            const spy = jest.spyOn(network.dispatcher, 'dispatch');
            const packet: MeshPacket = {
                id: 'duplicate-id',
                topic: 'test',
                data: {},
                senderNodeID: 'other-node',
                namespace: 'test-ns',
                type: 'EVENT',
                timestamp: Date.now(),
                version: 1,
                priority: 1,
                meta: {}
            };

            transport.emit('packet', packet);
            await new Promise(resolve => setTimeout(resolve, 20));
            transport.emit('packet', packet); // Same ID

            expect(spy).toHaveBeenCalledTimes(1);
        });

        it('should NOT deduplicate RESPONSE packets (allows ID reuse)', async () => {
            const spy = jest.spyOn(network.dispatcher, 'dispatch');
            const packet: MeshPacket = {
                id: 'same-id',
                topic: 'test',
                data: {},
                senderNodeID: 'other-node',
                namespace: 'test-ns',
                type: 'RESPONSE',
                timestamp: Date.now(),
                version: 1,
                priority: 1,
                meta: {}
            };

            transport.emit('packet', packet);
            await new Promise(resolve => setTimeout(resolve, 20));
            transport.emit('packet', packet);
            await new Promise(resolve => setTimeout(resolve, 20));

            expect(spy).toHaveBeenCalledTimes(2);
        });

        it('should update registry heartbeat on packet arrival', async () => {
            const packet: MeshPacket = {
                id: 'p1',
                topic: 'test',
                data: {},
                senderNodeID: 'sender-xyz',
                namespace: 'test-ns',
                type: 'EVENT',
                timestamp: Date.now(),
                version: 1,
                priority: 1,
                meta: {}
            };

            transport.emit('packet', packet);
            await new Promise(resolve => setTimeout(resolve, 20));
            expect(registry.heartbeat).toHaveBeenCalledWith('sender-xyz');
        });

        it('should execute inbound interceptors in reverse order', async () => {
            const order: string[] = [];
            network.use({
                name: 'i1',
                onInbound: async (p) => { order.push('first'); return p; }
            });
            network.use({
                name: 'i2',
                onInbound: async (p) => { order.push('second'); return p; }
            });

            const packet: MeshPacket = {
                id: 'p1',
                topic: 'test',
                data: {},
                senderNodeID: 'other',
                namespace: 'test-ns',
                type: 'EVENT',
                timestamp: Date.now(),
                version: 1,
                priority: 1,
                meta: {}
            };

            transport.emit('packet', packet);
            await new Promise(resolve => setTimeout(resolve, 20));
            expect(order).toEqual(['second', 'first']);
        });
    });

    // ─── outbound logic ──────────────────────────────────────────────────────

    describe('Outbound Packet Handling', () => {
        it('should send a packet with default metadata', async () => {
            await network.send('target-1', 'test.topic', { foo: 'bar' });

            expect(transport.send).toHaveBeenCalledWith('target-1', expect.objectContaining({
                topic: 'test.topic',
                data: { foo: 'bar' },
                senderNodeID: nodeID,
                targetNodeID: 'target-1',
                meta: expect.objectContaining({
                    ttl: 5,
                    path: [nodeID]
                })
            }));
        });

        it('should increase priority for system topics (raft, kademlia)', async () => {
            await network.send('target-1', 'raft.vote', {});
            expect(transport.send).toHaveBeenCalledWith('target-1', expect.objectContaining({
                priority: 2
            }));
        });

        it('should throw error and NOT send if circuit is open', async () => {
            network.use({
                name: 'cb',
                onOutbound: async (p) => {
                    return { ...p, topic: '__circuit_open' };
                }
            });

            await network.send('target-1', 'test', {});
            expect(transport.send).not.toHaveBeenCalled();
        });

        it('should execute outbound interceptors in registration order', async () => {
            const order: string[] = [];
            network.use({
                name: 'o1',
                onOutbound: async (p) => { order.push('first'); return p; }
            });
            network.use({
                name: 'o2',
                onOutbound: async (p) => { order.push('second'); return p; }
            });

            await network.send('target-1', 'test', {});
            expect(order).toEqual(['first', 'second']);
        });

        it('should publish a packet to all connected peers', async () => {
            await network.publish('broadcast.topic', { data: 123 });
            expect(transport.publish).toHaveBeenCalledWith('broadcast.topic', expect.objectContaining({
                topic: 'broadcast.topic',
                data: { data: 123 },
                type: 'EVENT'
            }));
        });
    });

    // ─── miscellaneous ───────────────────────────────────────────────────────

    describe('Miscellaneous', () => {
        it('should support generic onMessage(*) handlers', async () => {
            const handler = jest.fn();
            network.onMessage('*', handler);

            const packet: MeshPacket = {
                id: 'p1',
                topic: 'any.topic',
                data: { val: 1 },
                senderNodeID: 'other',
                namespace: 'test-ns',
                type: 'EVENT',
                timestamp: Date.now(),
                version: 1,
                priority: 1,
                meta: {}
            };

            transport.emit('packet', packet);
            await new Promise(resolve => setTimeout(resolve, 20));
            expect(handler).toHaveBeenCalledWith({ val: 1 }, expect.objectContaining({ id: 'p1' }));
        });
    });
});
