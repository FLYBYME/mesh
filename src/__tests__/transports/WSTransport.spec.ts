import { WSTransport } from '../../transports/node/WSTransport.js';
import { JSONSerializer } from '../../serializers/JSONSerializer.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'node:http';
import { MeshPacket } from '../../interfaces/IMeshNetwork.js';
import { AuthHandshakeManager } from '../../core/AuthHandshakeManager.js';
import { IServiceRegistry } from '../../interfaces/IServiceRegistry.js';

jest.mock('ws');
jest.mock('node:http');
jest.mock('../../core/AuthHandshakeManager.js');

describe('WSTransport', () => {
    let transport: WSTransport;
    let serializer: JSONSerializer;
    let logger: Logger;
    let registry: IServiceRegistry;

    // Strongly type the mocks using jest.mocked
    const MockedWebSocket = jest.mocked(WebSocket);
    const MockedWSServer = jest.mocked(WebSocketServer);
    const MockedHttp = jest.mocked(http);
    const MockedAuthManager = jest.mocked(AuthHandshakeManager);

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
        
        registry = {
            getNode: jest.fn().mockReturnValue({ publicKey: 'test-pub-key' }),
        } as any;

        transport = new WSTransport(serializer, 5005);
        transport.logger = logger;

        // Clear mocks
        MockedWSServer.mockClear();
        MockedWebSocket.mockClear();
        MockedHttp.createServer.mockClear();
        MockedHttp.createServer.mockReturnValue(createMockServer() as any);
        MockedAuthManager.verifyResponse.mockResolvedValue(true);
        MockedAuthManager.createResponse.mockResolvedValue('test-signature');
        MockedAuthManager.generateChallenge.mockReturnValue('test-challenge');
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
                logger,
                registry,
                privateKey: 'test-priv-key'
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
                sharedServer: mockServer,
                registry,
                privateKey: 'test-priv-key'
            });

            expect(MockedWSServer).toHaveBeenCalledWith(expect.objectContaining({ server: mockServer }));
            expect(transport.isConnected()).toBe(true);
        });
    });

    describe('Peering & Reconnection', () => {
        it('should connect to a peer and emit event after handshake', async () => {
            const mockWS = createMockWS();
            let messageHandler: ((data: any) => void) | undefined;
            mockWS.on.mockImplementation((event: string, cb: any) => {
                if (event === 'open') setTimeout(cb, 0);
                if (event === 'message') messageHandler = cb;
            });
            MockedWebSocket.mockReturnValue(mockWS as any);

            await transport.connect({ nodeID: 'test-node', namespace: 'default', url: '', logger, registry, privateKey: 'test-priv-key' });
            const promise = transport.connectToPeer('remote-node', 'ws://remote:5005');
            
            const peerConnectSpy = jest.fn();
            transport.on('peer:connect', peerConnectSpy);

            await promise;

            expect(MockedWebSocket).toHaveBeenCalledWith('ws://remote:5005');
            
            // Simulate receiving a challenge
            const challengePacket = {
                type: 'AUTH',
                senderNodeID: 'remote-node',
                data: { type: 'challenge', challenge: 'remote-challenge' }
            };
            if (messageHandler) await messageHandler(JSON.stringify(challengePacket));
            await new Promise(resolve => setTimeout(resolve, 10));

            // Simulate receiving a response to OUR challenge
            const responsePacket = {
                type: 'AUTH',
                senderNodeID: 'remote-node',
                data: { type: 'response', response: 'sig', nodeID: 'remote-node', challenge: 'test-challenge' }
            };
            if (messageHandler) await messageHandler(JSON.stringify(responsePacket));
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(peerConnectSpy).toHaveBeenCalledWith('remote-node');
        });
    });

    describe('Message Handling', () => {
        it('should suppress loopback packets from self', async () => {
            await transport.connect({ nodeID: 'test-node', namespace: 'default', url: '', logger, registry, privateKey: 'test-priv-key' });
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

            const peerState = { ws: createMockWS(), nodeID: 'remote', isAuthenticated: true };
            const payload = Buffer.from(serializer.serialize(packet));
            await (transport as any).handleIncomingMessage(payload, peerState);

            expect(packetSpy).not.toHaveBeenCalled();
        });

        it('should handle RESPONSE packets and resolve pending RPCs', async () => {
            const mockWS = createMockWS();
            let messageHandler: ((data: any) => void) | undefined;
            mockWS.on.mockImplementation((event: string, cb: any) => {
                if (event === 'open') setTimeout(cb, 0);
                if (event === 'message') messageHandler = cb;
            });
            MockedWebSocket.mockReturnValue(mockWS as any);

            await transport.connect({ nodeID: 'test-node', namespace: 'default', url: '', logger, registry, privateKey: 'test-priv-key' });
            await transport.connectToPeer('remote', 'ws://remote:5005');

            // Complete handshake
            const responsePacketAuth = {
                type: 'AUTH',
                senderNodeID: 'remote',
                data: { type: 'response', response: 'sig', nodeID: 'remote', challenge: 'test-challenge' }
            };
            if (messageHandler) await messageHandler(JSON.stringify(responsePacketAuth));
            await new Promise(resolve => setTimeout(resolve, 10));

            const callPromise = transport.call('remote', 'math.add', { a: 1, b: 2 });
            await new Promise(resolve => setTimeout(resolve, 10));

            // Capture the ID from the sent packet (might be the 2nd send after the auth response)
            const sendCalls = mockWS.send.mock.calls;
            const rpcCall = sendCalls.find(call => {
                const p = JSON.parse(call[0]);
                return p.type === 'REQUEST';
            });
            expect(rpcCall).toBeDefined();
            const sentPayload = JSON.parse(rpcCall[0]);
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

            const peerState = (transport as any).peerStates.values().next().value;
            await (transport as any).handleIncomingMessage(Buffer.from(serializer.serialize(responsePacket)), peerState);

            const result = await callPromise;
            expect(result).toEqual({ result: 3 });
        });
    });

    describe('Routing', () => {
        it('should route via proxy if target is not directly connected', async () => {
            const proxyWS = createMockWS();
            let messageHandler: ((data: any) => void) | undefined;
            
            proxyWS.on.mockImplementation((event: string, cb: any) => {
                if (event === 'open') setTimeout(cb, 0);
                if (event === 'message') messageHandler = cb;
            });
            MockedWebSocket.mockReturnValue(proxyWS as any);
            await transport.connect({ nodeID: 'test-node', namespace: 'default', url: '', logger, registry, privateKey: 'test-priv-key' });
            await transport.connectToPeer('proxy-node', 'ws://proxy:5005');

            // Complete handshake
            const responsePacketAuth = {
                type: 'AUTH',
                senderNodeID: 'proxy-node',
                data: { type: 'response', response: 'sig', nodeID: 'proxy-node', challenge: 'test-challenge' }
            };
            if (messageHandler) await messageHandler(JSON.stringify(responsePacketAuth));
            await new Promise(resolve => setTimeout(resolve, 10));

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
            await new Promise(resolve => setTimeout(resolve, 10));

            // Expect the packet to be sent via proxyWS
            const rpcCall = proxyWS.send.mock.calls.find(call => {
                const p = JSON.parse(call[0]);
                return p.topic === 'test';
            });
            expect(rpcCall).toBeDefined();
            const sentPayload = JSON.parse(rpcCall[0]);
            expect(sentPayload.meta.path).toContain('test-node');
        });
    });
});
