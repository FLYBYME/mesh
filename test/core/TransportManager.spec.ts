import { TransportManager } from '../../src/core/TransportManager.js';
import { MockTransport } from '../../src/transports/MockTransport.js';
import { JSONSerializer } from '../../src/serializers/JSONSerializer.js';
import { ILogger } from '../../src/interfaces/ILogger.js';
import { IMeshNetworkNode, MeshPacket } from '../../src/interfaces/IMeshNetwork.js';
import { IServiceRegistry } from '../../src/interfaces/IServiceRegistry.js';

describe('TransportManager', () => {
    let transportManager: TransportManager;
    let mockNode: jest.Mocked<IMeshNetworkNode>;
    let mockLogger: jest.Mocked<ILogger>;
    let mockRegistry: jest.Mocked<IServiceRegistry>;
    let transport1: MockTransport;
    let transport2: MockTransport;
    let serializer: JSONSerializer;

    beforeEach(() => {
        serializer = new JSONSerializer();
        mockLogger = {
            info: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
            warn: jest.fn()
        } as any;

        mockRegistry = {
            getNode: jest.fn(),
            registerNode: jest.fn(),
            heartbeat: jest.fn(),
        } as any;

        mockNode = {
            nodeID: 'test-node',
            namespace: 'default',
            logger: mockLogger,
            registry: mockRegistry,
            orchestrator: {
                handlePeerConnect: jest.fn(),
                handlePeerDisconnect: jest.fn()
            }
        } as any;

        transport1 = new MockTransport(serializer);
        transport2 = new MockTransport(serializer);
        // Manually set protocols if needed, but MockTransport defaults to 'mock'
        // Actually BaseTransport has protocol: TransportType
        (transport2 as any).protocol = 'tcp';

        transportManager = new TransportManager({
            transports: [transport1, transport2]
        }, mockNode);
    });

    describe('Constructor', () => {
        it('should throw if no transports provided', () => {
            expect(() => new TransportManager({ transports: [] }, mockNode)).toThrow();
        });

        it('should set primary transport', () => {
            expect(transportManager.getTransport()).toBe(transport1);
        });
    });

    describe('Lifecycle', () => {
        it('should connect all transports', async () => {
            const spy1 = jest.spyOn(transport1, 'connect');
            const spy2 = jest.spyOn(transport2, 'connect');

            await transportManager.connect({ url: 'test-url' });

            expect(spy1).toHaveBeenCalledWith(expect.objectContaining({ url: 'test-url', nodeID: 'test-node' }));
            expect(spy2).toHaveBeenCalledWith(expect.objectContaining({ url: 'test-url', nodeID: 'test-node' }));
        });

        it('should disconnect all transports', async () => {
            const spy1 = jest.spyOn(transport1, 'disconnect');
            const spy2 = jest.spyOn(transport2, 'disconnect');

            await transportManager.disconnect();

            expect(spy1).toHaveBeenCalled();
            expect(spy2).toHaveBeenCalled();
        });
    });

    describe('Packet Handling', () => {
        it('should emit packet event when any transport receives a packet', (done) => {
            const testPacket: MeshPacket = { id: 'pkt-1', topic: 'test' } as any;
            transportManager.on('packet', (packet) => {
                expect(packet).toBe(testPacket);
                done();
            });

            transport1.emit('packet', testPacket);
        });

        it('should multiplex outgoing packets to best route', async () => {
            const packet: MeshPacket = { id: 'pkt-out', topic: 'test' } as any;
            
            // Mock registry to return a node with a TCP address
            mockRegistry.getNode.mockReturnValue({
                addresses: ['tcp://127.0.0.1:9000']
            } as any);

            const spy1 = jest.spyOn(transport1, 'send');
            const spy2 = jest.spyOn(transport2, 'send');

            await transportManager.send('remote-node', packet);

            expect(spy2).toHaveBeenCalledWith('remote-node', packet);
            expect(spy1).not.toHaveBeenCalled();
        });

        it('should fallback to primary transport if no specific route found', async () => {
            const packet: MeshPacket = { id: 'pkt-out', topic: 'test' } as any;
            mockRegistry.getNode.mockReturnValue(undefined);

            const spy1 = jest.spyOn(transport1, 'send');

            await transportManager.send('unknown-node', packet);

            expect(spy1).toHaveBeenCalledWith('unknown-node', packet);
        });
    });

    describe('Peer Lifecycle', () => {
        it('should notify orchestrator on peer connect', () => {
            transport1.emit('peer:connect', 'peer-1');
            expect(mockNode.orchestrator!.handlePeerConnect).toHaveBeenCalledWith('peer-1');
        });

        it('should notify orchestrator on peer disconnect', () => {
            transport1.emit('peer:disconnect', 'peer-1');
            expect(mockNode.orchestrator!.handlePeerDisconnect).toHaveBeenCalledWith('peer-1');
        });
    });

    describe('Status', () => {
        it('should return true for isConnected if any transport is connected', () => {
            jest.spyOn(transport1, 'isConnected').mockReturnValue(false);
            jest.spyOn(transport2, 'isConnected').mockReturnValue(true);

            expect(transportManager.isConnected()).toBe(true);
        });

        it('should return false for isConnected if no transport is connected', () => {
            jest.spyOn(transport1, 'isConnected').mockReturnValue(false);
            jest.spyOn(transport2, 'isConnected').mockReturnValue(false);

            expect(transportManager.isConnected()).toBe(false);
        });
    });

    describe('Type Selection', () => {
        it('should return transport by type', () => {
            expect(transportManager.getTransportByType('mock')).toBe(transport1);
            expect(transportManager.getTransportByType('tcp')).toBe(transport2);
        });

        it('should return undefined for unknown type', () => {
            expect(transportManager.getTransportByType('nats')).toBeUndefined();
        });
    });
});
