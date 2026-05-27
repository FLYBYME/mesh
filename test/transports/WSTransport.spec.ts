import { WSTransport } from '../../src/transports/node/WSTransport.js';
import { JSONSerializer } from '../../src/serializers/JSONSerializer.js';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import EventEmitter from 'node:events';

jest.mock('node:http');
jest.mock('ws');

class MockWSServer extends EventEmitter {
    close = jest.fn();
    on = jest.fn().mockImplementation(super.on.bind(this));
}

class MockWS extends EventEmitter {
    readyState = 1;
    send = jest.fn();
    close = jest.fn();
    terminate = jest.fn();
    ping = jest.fn();
    on = jest.fn().mockImplementation(super.on.bind(this));
    bufferedAmount = 0;
}

class MockHttpServer extends EventEmitter {
    listen = jest.fn((port, cb) => {
        if (cb) cb();
        return this;
    });
    close = jest.fn((cb) => {
        if (cb) cb();
        return this;
    });
    address = jest.fn().mockReturnValue({ port: 3000 });
}

describe('WSTransport', () => {
    let transport: WSTransport;
    let serializer: JSONSerializer;
    let mockWss: MockWSServer;
    let mockHttp: MockHttpServer;

    beforeEach(() => {
        serializer = new JSONSerializer();
        transport = new WSTransport(serializer, 3000);
        mockWss = new MockWSServer();
        mockHttp = new MockHttpServer();
        (http.createServer as jest.Mock).mockReturnValue(mockHttp);
        (WebSocketServer as unknown as jest.Mock).mockReturnValue(mockWss);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should initialize correctly', () => {
        expect(transport.protocol).toBe('ws');
        expect(transport.version).toBe(1);
    });

    describe('connect', () => {
        it('should start a standalone HTTP server and WSS', async () => {
            await transport.connect({ nodeID: 'test-node', url: '', namespace: 'default' } as any);

            expect(http.createServer).toHaveBeenCalled();
            expect(mockHttp.listen).toHaveBeenCalledWith(3000, expect.any(Function));
            expect(WebSocketServer).toHaveBeenCalledWith({ server: mockHttp });
            expect(transport.isConnected()).toBe(true);
        });

        it('should attach to a shared server', async () => {
            const sharedServer = new MockHttpServer() as any;
            await transport.connect({ nodeID: 'test-node', sharedServer, url: '', namespace: 'default' } as any);

            expect(http.createServer).not.toHaveBeenCalled();
            expect(WebSocketServer).toHaveBeenCalledWith({ server: sharedServer });
            expect(transport.isConnected()).toBe(true);
        });
    });

    describe('handleIncomingMessage', () => {
        let mockWs: MockWS;

        beforeEach(async () => {
            await transport.connect({ nodeID: 'server-node', url: '', namespace: 'default' } as any);
            mockWs = new MockWS();
        });

        it('should identify peer and emit connect event', (done) => {
            const packet = {
                type: 'EVENT',
                topic: 'test',
                senderNodeID: 'peer-1',
                version: 1,
                id: '1',
                timestamp: Date.now()
            };
            const raw = serializer.serialize(packet);

            transport.on('peer:connect', (id) => {
                expect(id).toBe('peer-1');
                done();
            });

            // Trigger connection
            const connectionHandler = (mockWss as any).on.mock.calls.find((c: any) => c[0] === 'connection')[1];
            connectionHandler(mockWs);

            // Trigger message
            const messageHandler = (mockWs as any).on.mock.calls.find((c: any) => c[0] === 'message')[1];
            messageHandler(raw);
        });

        it('should handle RPC responses', async () => {
            const mockWs = new MockWS();
            const connectionHandler = (mockWss as any).on.mock.calls.find((c: any) => c[0] === 'connection')[1];
            connectionHandler(mockWs);

            // Add the peer so send() doesn't fail/skip
            (transport as any).peers.set('peer-1', mockWs);

            const callPromise = transport.call('peer-1', 'topic', { foo: 'bar' });

            const pendingRPCs = (transport as any).pendingRPCs;
            const rpcId = Array.from(pendingRPCs.keys())[0] as string;

            const response = {
                type: 'RESPONSE',
                id: rpcId,
                data: { result: 'ok' },
                senderNodeID: 'peer-1',
                version: 1
            };
            
            const messageHandler = (mockWs as any).on.mock.calls.find((c: any) => c[0] === 'message')[1];
            messageHandler(serializer.serialize(response));

            await expect(callPromise).resolves.toEqual({ result: 'ok' });
        });
    });

    describe('disconnect', () => {
        it('should close all connections', async () => {
            await transport.connect({ nodeID: 'node', url: '', namespace: 'default' } as any);
            const mockWs = new MockWS();
            (transport as any).peers.set('peer-1', mockWs);

            await transport.disconnect();

            expect(mockWs.terminate).toHaveBeenCalled();
            expect(mockWss.close).toHaveBeenCalled();
            expect(mockHttp.close).toHaveBeenCalled();
            expect(transport.isConnected()).toBe(false);
        });
    });
});
