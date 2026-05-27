import { MeshNetwork } from '../../src/core/MeshNetwork.js';
import { MockTransport } from '../../src/transports/MockTransport.js';
import { JSONSerializer } from '../../src/serializers/JSONSerializer.js';
import { ILogger } from '../../src/interfaces/ILogger.js';
import { IServiceRegistry } from '../../src/interfaces/IServiceRegistry.js';
import { MeshPacket } from '../../src/interfaces/IMeshNetwork.js';
import { IInterceptor } from '../../src/interfaces/IInterceptor.js';

describe('MeshNetwork', () => {
    let network: MeshNetwork;
    let mockLogger: jest.Mocked<ILogger>;
    let mockRegistry: jest.Mocked<IServiceRegistry>;
    let transport: MockTransport;
    let serializer: JSONSerializer;

    beforeEach(() => {
        serializer = new JSONSerializer();
        mockLogger = {
            info: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
            warn: jest.fn(),
            child: jest.fn().mockReturnThis(),
            getLevel: jest.fn().mockReturnValue(0)
        } as any;

        mockRegistry = {
            getNode: jest.fn(),
            registerNode: jest.fn(),
            heartbeat: jest.fn(),
            on: jest.fn()
        } as any;

        transport = new MockTransport(serializer);

        network = new MeshNetwork({
            nodeId: 'test-node',
            namespace: 'default',
            transports: [transport]
        }, mockLogger, mockRegistry);
    });

    afterEach(async () => {
        await network.stop();
    });

    describe('Packet Deduplication', () => {
        it('should process a packet once and ignore duplicates within TTL', async () => {
            const handler = jest.fn();
            network.onMessage('test.topic', handler);

            const packet: MeshPacket = {
                id: 'pkt-unique-1',
                topic: 'test.topic',
                senderNodeID: 'other-node',
                namespace: 'default',
                type: 'EVENT',
                timestamp: Date.now(),
                version: 1,
                priority: 1
            } as any;

            // First time
            transport.emit('packet', packet);
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(handler).toHaveBeenCalledTimes(1);

            // Duplicate
            transport.emit('packet', packet);
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(handler).toHaveBeenCalledTimes(1); // Still 1
        });

        it('should allow RESPONSE packets with same ID (Phase 3 logic)', async () => {
            const handler = jest.fn();
            network.onMessage('test.topic', handler);

            const packet: MeshPacket = {
                id: 'pkt-id-1',
                topic: 'test.topic',
                senderNodeID: 'other-node',
                namespace: 'default',
                type: 'RESPONSE',
                timestamp: Date.now(),
                version: 1,
                priority: 1
            } as any;

            transport.emit('packet', packet);
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(handler).toHaveBeenCalledTimes(1);

            transport.emit('packet', packet);
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(handler).toHaveBeenCalledTimes(2); // Allowed for RESPONSE
        });
    });

    describe('Namespace Isolation', () => {
        it('should ignore packets from different namespaces', async () => {
            const handler = jest.fn();
            network.onMessage('test.topic', handler);

            const packet: MeshPacket = {
                id: 'pkt-ns-1',
                topic: 'test.topic',
                senderNodeID: 'other-node',
                namespace: 'other-namespace',
                type: 'EVENT',
                timestamp: Date.now(),
                version: 1,
                priority: 1
            } as any;

            transport.emit('packet', packet);
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(handler).not.toHaveBeenCalled();
        });
    });

    describe('Loopback Suppression', () => {
        it('should ignore packets from self that came through transport', async () => {
            const handler = jest.fn();
            network.onMessage('test.topic', handler);

            const packet: MeshPacket = {
                id: 'pkt-self',
                topic: 'test.topic',
                senderNodeID: 'test-node',
                namespace: 'default',
                type: 'EVENT',
                timestamp: Date.now(),
                version: 1,
                priority: 1
            } as any;

            transport.emit('packet', packet);
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(handler).not.toHaveBeenCalled();
        });
    });

    describe('Interceptors', () => {
        it('should apply inbound interceptors', async () => {
            const handler = jest.fn();
            network.onMessage('test.topic', handler);

            const interceptor: IInterceptor<MeshPacket, MeshPacket> = {
                name: 'test-interceptor',
                onInbound: jest.fn().mockImplementation(async (p) => {
                    return { ...p, data: { intercepted: true } };
                })
            };
            network.use(interceptor);

            const packet: MeshPacket = {
                id: 'pkt-intercept-in',
                topic: 'test.topic',
                senderNodeID: 'other-node',
                namespace: 'default',
                data: { intercepted: false },
                type: 'EVENT',
                timestamp: Date.now(),
                version: 1,
                priority: 1
            } as any;

            transport.emit('packet', packet);
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(interceptor.onInbound).toHaveBeenCalled();
            expect(handler).toHaveBeenCalledWith({ intercepted: true }, expect.anything());
        });

        it('should apply outbound interceptors', async () => {
            const interceptor: IInterceptor<MeshPacket, MeshPacket> = {
                name: 'test-outbound',
                onOutbound: jest.fn().mockImplementation(async (p) => {
                    return { ...p, topic: 'intercepted.topic' };
                })
            };
            network.use(interceptor);

            const sendSpy = jest.spyOn(transport, 'send');
            await network.send('target-node', 'original.topic', { foo: 'bar' });

            expect(interceptor.onOutbound).toHaveBeenCalled();
            expect(sendSpy).toHaveBeenCalledWith('target-node', expect.objectContaining({
                topic: 'intercepted.topic'
            }));
        });

        it('should allow interceptor to drop packet by throwing or returning special value (if supported)', async () => {
             // In current implementation, if interceptor throws, it might crash the loop or be caught.
             // Looking at MeshNetwork.ts, there's no try-catch around interceptor execution in transport.on('packet').
             // But let's see what happens if it returns something that won't match.
             const interceptor: IInterceptor<MeshPacket, MeshPacket> = {
                name: 'drop-interceptor',
                onInbound: jest.fn().mockImplementation(async (p) => {
                    return { ...p, topic: 'dropped' };
                })
            };
            network.use(interceptor);
            const handler = jest.fn();
            network.onMessage('real.topic', handler);

            transport.emit('packet', {
                id: 'pkt-drop',
                topic: 'real.topic',
                senderNodeID: 'other-node',
                namespace: 'default',
                type: 'EVENT'
            } as any);
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(handler).not.toHaveBeenCalled();
        });
    });

    describe('Packet Flow', () => {
        it('should verify flow: transport -> dedup -> interceptors -> generic handlers -> dispatcher', (done) => {
            const order: string[] = [];
            
            // 1. Interceptor
            network.use({
                name: 'flow-interceptor',
                onInbound: async (p) => {
                    order.push('interceptor');
                    return p;
                }
            });

            // 2. Generic Handler (*)
            network.onMessage('*', () => {
                order.push('generic');
            });

            // 3. Specific Handler
            network.onMessage('test.topic', () => {
                order.push('dispatcher');
                
                try {
                    expect(order).toEqual(['interceptor', 'generic', 'dispatcher']);
                    done();
                } catch (err) {
                    done(err);
                }
            });

            transport.emit('packet', {
                id: 'pkt-flow',
                topic: 'test.topic',
                senderNodeID: 'other-node',
                namespace: 'default',
                type: 'EVENT'
            } as any);
        });
    });

    describe('Error Handling', () => {
        it('should handle send failures gracefully', async () => {
            jest.spyOn(transport, 'send').mockRejectedValue(new Error('Send failed'));
            
            await expect(network.send('target', 'topic', {})).resolves.not.toThrow();
            expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to send to target'), expect.anything());
        });

        it('should handle publish failures gracefully', async () => {
            jest.spyOn(transport, 'publish').mockRejectedValue(new Error('Publish failed'));
            
            await expect(network.publish('topic', {})).resolves.not.toThrow();
            expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to publish to topic'), expect.anything());
        });

        it('should handle generic handler errors gracefully', async () => {
            network.onMessage('*', () => {
                throw new Error('Generic handler error');
            });

            const packet = {
                id: 'pkt-err-generic',
                topic: 'test',
                senderNodeID: 'other-node',
                namespace: 'default',
                type: 'EVENT'
            } as any;

            transport.emit('packet', packet);
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Error in generic packet handler'), expect.anything());
        });
    });

    describe('NetworkController integration', () => {
        it('should register standard handlers', () => {
            // These should be registered by constructor calling controller.registerHandlers
            expect(network.dispatcher.hasHandler('$node.ping')).toBe(true);
            expect(network.dispatcher.hasHandler('$node.announce')).toBe(true);
            expect(network.dispatcher.hasHandler('$rpc.request')).toBe(true);
        });

        it('should handle $node.ping by sending $node.pong', async () => {
            const publishSpy = jest.spyOn(network, 'publish');
            
            transport.emit('packet', {
                id: 'ping-id',
                topic: '$node.ping',
                senderNodeID: 'other-node',
                namespace: 'default',
                type: 'EVENT'
            } as any);

            await new Promise(resolve => setTimeout(resolve, 0));

            expect(mockRegistry.heartbeat).toHaveBeenCalledWith('other-node');
            expect(publishSpy).toHaveBeenCalledWith('$node.pong', expect.objectContaining({
                id: 'ping-id'
            }));
        });

        it('should handle $node.announce by registering node', async () => {
            transport.emit('packet', {
                id: 'ann-id',
                topic: '$node.announce',
                senderNodeID: 'new-node',
                namespace: 'default',
                type: 'EVENT',
                data: {
                    hostname: 'new-host',
                    services: [{ domain: 'test', action: 'run' }]
                }
            } as any);

            await new Promise(resolve => setTimeout(resolve, 0));

            expect(mockRegistry.registerNode).toHaveBeenCalledWith(expect.objectContaining({
                nodeID: 'new-node',
                hostname: 'new-host'
            }));
        });
    });
});
