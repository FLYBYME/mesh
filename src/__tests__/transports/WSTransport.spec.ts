import { WSTransport } from '../../transports/node/WSTransport.js';
import { JSONSerializer } from '../../serializers/JSONSerializer.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'node:http';
import { MeshPacket } from '../../interfaces/IMeshNetwork.js';

jest.mock('ws');
jest.mock('node:http');

describe('WSTransport', () => {
    let transport: WSTransport;
    let serializer: JSONSerializer;
    let logger: Logger;

    // Strongly type the mocks using jest.mocked
    const MockedWebSocket = jest.mocked(WebSocket);
    const MockedWSServer = jest.mocked(WebSocketServer);
    const MockedHttp = jest.mocked(http);

    const createMockWS = () => ({
        on: jest.fn(),
        once: jest.fn(),
        send: jest.fn(),
        close: jest.fn(),
        terminate: jest.fn(),
        readyState: 1,
        ping: jest.fn(),
        bufferedAmount: 0
    });

    const createMockServer = () => ({
        listen: jest.fn((_p: number, cb: () => void) => cb && cb()),
        address: jest.fn(() => ({ port: 5005 })),
        on: jest.fn(),
        close: jest.fn((cb: () => void) => cb && cb())
    });

    beforeEach(() => {
        serializer = new JSONSerializer();
        logger = new Logger(LogLevel.ERROR);
        transport = new WSTransport(serializer, 5005);
        transport.logger = logger;

        // Clear mocks
        MockedWSServer.mockClear();
        MockedWebSocket.mockClear();
        MockedHttp.createServer.mockClear();
        MockedHttp.createServer.mockReturnValue(createMockServer() as any);
    });

    afterEach(async () => {
        await transport.disconnect();
    });

    describe('Lifecycle', () => {
        it('should start a standalone server when connecting', async () => {
            const mockServer = createMockServer();
            MockedHttp.createServer.mockReturnValue(mockServer as any);

            await transport.connect({
                nodeID: 'test-node',
                namespace: 'default',
                url: '',
                logger
            });

            expect(MockedHttp.createServer).toHaveBeenCalled();
            expect(mockServer.listen).toHaveBeenCalledWith(5005, expect.any(Function));
            expect(transport.isConnected()).toBe(true);
        });

        it('should attach to a shared server', async () => {
            const mockServer = createMockServer() as any;
            await transport.connect({
                nodeID: 'test-node',
                namespace: 'default',
                url: '',
                logger,
                sharedServer: mockServer
            });

            expect(MockedWSServer).toHaveBeenCalledWith(expect.objectContaining({ server: mockServer }));
            expect(transport.isConnected()).toBe(true);
        });
    });

    describe('Peering & Reconnection', () => {
        it('should connect to a peer and emit event', async () => {
            const mockWS = createMockWS();
            mockWS.on.mockImplementation((event: string, cb: any) => {
                if (event === 'open') setTimeout(cb, 0);
            });
            MockedWebSocket.mockReturnValue(mockWS as any);

            await transport.connect({ nodeID: 'test-node', namespace: 'default', url: '', logger });
            const promise = transport.connectToPeer('remote-node', 'ws://remote:5005');
            
            const peerConnectSpy = jest.fn();
            transport.on('peer:connect', peerConnectSpy);

            await promise;

            expect(MockedWebSocket).toHaveBeenCalledWith('ws://remote:5005');
            expect(peerConnectSpy).toHaveBeenCalledWith('remote-node');
        });

        it('should attempt reconnection on close', async () => {
            jest.useFakeTimers();
            const mockWS = createMockWS();
            let closeHandler: (() => void) | undefined;

            mockWS.on.mockImplementation((event: string, cb: any) => {
                if (event === 'open') setTimeout(cb, 0);
                if (event === 'close') closeHandler = cb;
            });
            MockedWebSocket.mockReturnValue(mockWS as any);

            // First connection
            await transport.connect({ nodeID: 'test-node', namespace: 'default', url: '', logger });
            const connectPromise = transport.connectToPeer('remote-node', 'ws://remote:5005');
            
            // Advance timers to trigger 'open'
            jest.runOnlyPendingTimers();
            await connectPromise;
            
            expect(MockedWebSocket).toHaveBeenCalledTimes(1);

            // Trigger close
            if (closeHandler) closeHandler();

            // Advance timers for backoff
            jest.runOnlyPendingTimers(); 
            
            // Re-mock for second connection
            const nextMockWS = createMockWS();
            nextMockWS.on.mockImplementation((event: string, cb: any) => {
                if (event === 'open') setTimeout(cb, 0);
            });
            MockedWebSocket.mockReturnValue(nextMockWS as any);
            
            jest.runOnlyPendingTimers(); 
            
            expect(MockedWebSocket).toHaveBeenCalledTimes(2);
            jest.useRealTimers();
        });
    });

    describe('Message Handling', () => {
        it('should suppress loopback packets from self', async () => {
            await transport.connect({ nodeID: 'test-node', namespace: 'default', url: '', logger });
            const packet: MeshPacket = {
                id: 'p1',
                topic: 'test',
                data: {},
                senderNodeID: 'test-node',
                type: 'EVENT',
                timestamp: Date.now(),
                version: 1,
                priority: 1,
                meta: {}
            };

            const packetSpy = jest.fn();
            transport.on('packet', packetSpy);

            const payload = Buffer.from(serializer.serialize(packet));
            (transport as any).handleIncomingMessage(payload, createMockWS());

            expect(packetSpy).not.toHaveBeenCalled();
        });

        it('should handle RESPONSE packets and resolve pending RPCs', async () => {
            const mockWS = createMockWS();
            const mockedOn = mockWS.on as jest.Mock;
            mockedOn.mockImplementation((event: string, cb: any) => {
                if (event === 'open') setTimeout(cb, 0);
            });
            MockedWebSocket.mockReturnValue(mockWS as any);

            await transport.connect({ nodeID: 'test-node', namespace: 'default', url: '', logger });
            await transport.connectToPeer('remote', 'ws://remote:5005');

            const callPromise = transport.call('remote', 'math.add', { a: 1, b: 2 });

            // Capture the ID from the sent packet
            expect(mockWS.send).toHaveBeenCalled();
            const sentPayload = JSON.parse(mockWS.send.mock.calls[0][0]);
            const requestId = sentPayload.id;

            const responsePacket: MeshPacket = {
                id: requestId,
                topic: 'math.add',
                data: { result: 3 },
                senderNodeID: 'remote',
                type: 'RESPONSE',
                timestamp: Date.now(),
                version: 1,
                priority: 1,
                meta: {}
            };

            (transport as any).handleIncomingMessage(Buffer.from(serializer.serialize(responsePacket)), mockWS);

            const result = await callPromise;
            expect(result).toEqual({ result: 3 });
        });
    });

    describe('Routing', () => {
        it('should route via proxy if target is not directly connected', async () => {
            const proxyWS = createMockWS();
            const mockedOn = proxyWS.on as jest.Mock;
            
            // Use connectToPeer to populate the peers map without 'as any'
            mockedOn.mockImplementation((event: string, cb: any) => {
                if (event === 'open') setTimeout(cb, 0);
            });
            MockedWebSocket.mockReturnValue(proxyWS as any);
            await transport.connect({ nodeID: 'test-node', namespace: 'default', url: '', logger });
            await transport.connectToPeer('proxy-node', 'ws://proxy:5005');

            const packet: MeshPacket = {
                id: 'p1',
                topic: 'test',
                data: {},
                senderNodeID: 'test-node',
                targetNodeID: 'target-node', // Not in peers map
                type: 'EVENT',
                timestamp: Date.now(),
                version: 1,
                priority: 1,
                meta: { path: ['test-node'] }
            };

            await transport.send('target-node', packet);

            expect(proxyWS.send).toHaveBeenCalled();
            const sentPayload = JSON.parse(proxyWS.send.mock.calls[0][0]);
            expect(sentPayload.meta.path).toContain('test-node');
        });
    });
});
