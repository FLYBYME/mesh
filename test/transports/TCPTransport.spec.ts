import { TCPTransport } from '../../src/transports/node/TCPTransport.js';
import { JSONSerializer } from '../../src/serializers/JSONSerializer.js';
import { WirePacketType } from '../../src/interfaces/IMeshNetwork.js';
import { TCPFrameCodec } from '../../src/transports/helpers/TCPFrameCodec.js';
import tls from 'node:tls';
import EventEmitter from 'node:events';

jest.mock('node:tls');

class MockSocket extends EventEmitter {
    authorized = true;
    remoteAddress = '127.0.0.1';
    write = jest.fn().mockReturnValue(true);
    destroy = jest.fn();
    end = jest.fn();
    unref = jest.fn();
}

class MockServer extends EventEmitter {
    listen = jest.fn((port, cb) => {
        if (cb) cb();
        return this;
    });
    close = jest.fn((cb) => {
        if (cb) cb();
        return this;
    });
    address = jest.fn().mockReturnValue({ port: 4000 });
}

describe('TCPTransport', () => {
    let transport: TCPTransport;
    let serializer: JSONSerializer;
    let mockServer: MockServer;

    beforeEach(() => {
        serializer = new JSONSerializer();
        transport = new TCPTransport(serializer);
        mockServer = new MockServer();
        (tls.createServer as jest.Mock).mockReturnValue(mockServer);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should initialize correctly', () => {
        expect(transport.protocol).toBe('tls');
        expect(transport.version).toBe(1);
    });

    describe('connect', () => {
        it('should start a TLS server', async () => {
            const connectPromise = transport.connect({
                nodeID: 'test-node',
                port: 4000,
                url: '',
                namespace: 'default',
                tls: { key: 'key', cert: 'cert' }
            } as any);

            await expect(connectPromise).resolves.toBeUndefined();
            expect(tls.createServer).toHaveBeenCalled();
            expect(mockServer.listen).toHaveBeenCalledWith(4000, expect.any(Function));
            expect(transport.isConnected()).toBe(true);
        });

        it('should reject if server fails to start', async () => {
            const error = new Error('Bind failed');
            mockServer.listen.mockImplementationOnce((port, cb) => {
                mockServer.emit('error', error);
                return mockServer;
            });

            const connectPromise = transport.connect({
                nodeID: 'test-node',
                port: 4000,
                url: '',
                namespace: 'default',
                tls: { key: 'key', cert: 'cert' }
            } as any);

            await expect(connectPromise).rejects.toThrow('Bind failed');
        });
    });

    describe('handleConnection', () => {
        let mockSocket: MockSocket;

        beforeEach(async () => {
            await transport.connect({
                nodeID: 'server-node',
                url: '',
                namespace: 'default',
                tls: { key: 'key', cert: 'cert' }
            } as any);
            mockSocket = new MockSocket();
        });

        it('should send auth challenge on new connection', () => {
            // Trigger connection handler
            const connectionHandler = (tls.createServer as jest.Mock).mock.calls[0][1];
            connectionHandler(mockSocket);

            expect(mockSocket.write).toHaveBeenCalled();
            const frame = mockSocket.write.mock.calls[0][0];
            expect(frame[0]).toBe(WirePacketType.AUTH);
        });

        it('should reject unauthorized mTLS connections', () => {
            mockSocket.authorized = false;
            (mockSocket as any).authorizationError = new Error('Cert expired');
            
            const connectionHandler = (tls.createServer as jest.Mock).mock.calls[0][1];
            connectionHandler(mockSocket);

            expect(mockSocket.destroy).toHaveBeenCalled();
        });

        it('should reject connections not in allowed CIDRs', () => {
            transport.allowedCIDRs = ['192.168.1.1'];
            mockSocket.remoteAddress = '10.0.0.1';

            const connectionHandler = (tls.createServer as jest.Mock).mock.calls[0][1];
            connectionHandler(mockSocket);

            expect(mockSocket.destroy).toHaveBeenCalled();
        });
    });

    describe('send', () => {
        it('should throw if target node is not connected', async () => {
            await expect(transport.send('unknown', { type: 'EVENT', topic: 'test', data: {}, id: '1', senderNodeID: 's', timestamp: 0 } as any)).rejects.toThrow(/not connected/);
        });

        it('should encode and write frame to socket', async () => {
            const mockSocket = new MockSocket();
            // Manually add peer as authenticated
            (transport as any).peers.set('peer-1', {
                socket: mockSocket,
                nodeID: 'peer-1',
                isAuthenticated: true,
                bufferList: [],
                bufferPotSize: 0
            });

            const packet = { type: 'EVENT' as const, topic: 'test', data: { foo: 'bar' }, id: '1234567890123456', senderNodeID: 's', timestamp: 0 };
            await transport.send('peer-1', packet);

            expect(mockSocket.write).toHaveBeenCalled();
            const frame = mockSocket.write.mock.calls[0][0];
            const result = TCPFrameCodec.decode(frame);
            expect(result.frame).toBeDefined();
            
            const decoded = serializer.deserialize(result.frame!.subarray(21));
            expect(decoded).toMatchObject({ topic: 'test', data: { foo: 'bar' } });
        });
    });

    describe('disconnect', () => {
        it('should close all peer sockets and the server', async () => {
            await transport.connect({ nodeID: 'node', url: '', namespace: 'default', tls: { key: 'k', cert: 'c' } } as any);
            
            const mockSocket = new MockSocket();
            (transport as any).peers.set('peer-1', {
                socket: mockSocket,
                nodeID: 'peer-1',
                isAuthenticated: true,
                bufferList: [],
                bufferPotSize: 0
            });

            await transport.disconnect();

            expect(mockSocket.destroy).toHaveBeenCalled();
            expect(mockServer.close).toHaveBeenCalled();
            expect(transport.isConnected()).toBe(false);
        });
    });
});
