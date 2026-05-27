import { ServiceBroker, MeshToolSchemaRegistry } from '../../src/core/ServiceBroker.js';
import { ILogger } from '../../src/interfaces/ILogger.js';
import { IMeshNetwork, IMeshPacket } from '../../src/interfaces/IMeshNetwork.js';
import { IServiceRegistry } from '../../src/interfaces/IServiceRegistry.js';
import { IServiceModule } from '../../src/interfaces/IServiceModule.js';
import { IBrokerPlugin } from '../../src/interfaces/IBrokerPlugin.js';
import { z } from 'zod';

describe('ServiceBroker', () => {
    let broker: ServiceBroker;
    let mockLogger: jest.Mocked<ILogger>;
    let mockNetwork: jest.Mocked<IMeshNetwork>;
    let mockRegistry: jest.Mocked<IServiceRegistry>;

    beforeEach(() => {
        MeshToolSchemaRegistry.clear();
        jest.clearAllMocks();
        mockLogger = {
            info: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
            warn: jest.fn()
        } as any;
        mockNetwork = {
            onMessage: jest.fn(),
            send: jest.fn().mockResolvedValue(undefined),
            publish: jest.fn().mockResolvedValue(undefined)
        } as any;
        mockRegistry = {
            registerModule: jest.fn(),
            selectNode: jest.fn(),
            getNode: jest.fn(),
            registerNode: jest.fn(),
            heartbeat: jest.fn()
        } as any;

        broker = new ServiceBroker('test-node', mockLogger);
        broker.setNetwork(mockNetwork);
        broker.setRegistry(mockRegistry);
    });

    afterEach(async () => {
        await broker.stop();
    });

    describe('Local Tool Registration', () => {
        it('should register a module and its tools', async () => {
            const mockModule: IServiceModule = {
                domain: 'test',
                getContracts: () => [{
                    domain: 'test',
                    action: 'hello',
                    inputSchema: z.object({ name: z.string() }),
                    outputSchema: z.string()
                }],
                execute: jest.fn().mockResolvedValue('Hello world'),
            } as any;

            await broker.registerModule(mockModule);

            expect(MeshToolSchemaRegistry.has('test.hello')).toBe(true);
            expect(mockRegistry.registerModule).toHaveBeenCalledWith(mockModule);
        });

        it('should fail if module domain is missing', async () => {
            const mockModule: any = { getContracts: () => [] };
            await expect(broker.registerModule(mockModule)).rejects.toThrow('[ServiceBroker] Module domain must be provided');
        });

        it('should call onInit when registering a module', async () => {
            const onInit = jest.fn().mockResolvedValue(undefined);
            const mockModule: any = {
                domain: 'test',
                getContracts: () => [],
                onInit
            };
            await broker.registerModule(mockModule);
            expect(onInit).toHaveBeenCalledWith(broker);
        });
    });

    describe('RPC Execution (Local)', () => {
        const mockModule: IServiceModule = {
            domain: 'math',
            getContracts: () => [{
                domain: 'math',
                action: 'add',
                inputSchema: z.object({ a: z.number(), b: z.number() }),
                outputSchema: z.number()
            }],
            execute: jest.fn().mockImplementation(async (domain, action, params) => {
                if (action === 'add') return params.a + params.b;
            }),
        } as any;

        beforeEach(async () => {
            await broker.registerModule(mockModule);
        });

        it('should successfully call a local tool', async () => {
            const result = await broker.call('math.add', { a: 5, b: 10 } as any);
            expect(result).toBe(15);
            expect(mockModule.execute).toHaveBeenCalled();
        });

        it('should validate input parameters using Zod', async () => {
            await expect(broker.call('math.add', { a: '5', b: 10 } as any))
                .rejects.toThrow('[ServiceBroker] Invalid params for tool math.add');
        });

        it('should validate output result using Zod', async () => {
            (mockModule.execute as jest.Mock).mockResolvedValueOnce('not a number');
            await expect(broker.call('math.add', { a: 5, b: 10 } as any))
                .rejects.toThrow(); // Zod error
        });

        it('should throw error if local tool is not found', async () => {
            await expect(broker.call('non.existent', {} as any))
                .rejects.toThrow('[ServiceBroker] Local tool not found: non.existent');
        });

        it('should handle errors thrown by the handler', async () => {
            (mockModule.execute as jest.Mock).mockRejectedValueOnce(new Error('Handler failed'));
            await expect(broker.call('math.add', { a: 5, b: 10 } as any))
                .rejects.toThrow('Handler failed');
        });
    });

    describe('RPC Execution (Remote)', () => {
        it('should execute a remote RPC call', async () => {
            mockRegistry.selectNode.mockReturnValueOnce({ nodeID: 'remote-node' } as any);
            
            const rpcPromise = broker.call('remote.tool', { foo: 'bar' } as any);

            expect(mockNetwork.send).toHaveBeenCalled();
            const [nodeID, topic, data, options] = mockNetwork.send.mock.calls[0];
            const correlationID = options!.id;

            const responseHandler = mockNetwork.onMessage.mock.calls.find(c => c[0] === '*')![1];
            responseHandler({ result: 'ok' }, {
                type: 'RESPONSE',
                id: correlationID!,
                senderNodeID: 'remote-node',
                topic: 'remote.tool',
                data: { result: 'ok' },
                meta: { correlationID },
                timestamp: Date.now(),
                version: 1,
                priority: 1
            });

            const result = await rpcPromise;
            expect(result).toEqual({ result: 'ok' });
            expect(nodeID).toBe('remote-node');
        });

        it('should handle remote RPC errors', async () => {
            mockRegistry.selectNode.mockReturnValueOnce({ nodeID: 'remote-node' } as any);
            
            const rpcPromise = broker.call('remote.tool', {} as any);

            const options = mockNetwork.send.mock.calls[0][3];
            const correlationID = options!.id;

            const responseHandler = mockNetwork.onMessage.mock.calls.find(c => c[0] === '*')![1];
            responseHandler(null, {
                type: 'RESPONSE_ERROR',
                id: correlationID!,
                senderNodeID: 'remote-node',
                topic: 'remote.tool',
                error: { message: 'Remote failure' },
                meta: { correlationID },
                timestamp: Date.now(),
                version: 1,
                priority: 1
            });

            await expect(rpcPromise).rejects.toThrow('Remote failure');
        });

        it('should timeout if no response is received', async () => {
            jest.useFakeTimers();
            mockRegistry.selectNode.mockReturnValueOnce({ nodeID: 'remote-node' } as any);
            
            const rpcPromise = broker.call('remote.tool', {} as any, { timeout: 1000 });

            jest.advanceTimersByTime(1001);

            await expect(rpcPromise).rejects.toThrow('[ServiceBroker] RPC Timeout');
            jest.useRealTimers();
        });

        it('should prefer options.nodeID if provided', async () => {
            const rpcPromise = broker.call('any.tool', {} as any, { nodeID: 'forced-node' });
            
            const options = mockNetwork.send.mock.calls[0][3];
            const responseHandler = mockNetwork.onMessage.mock.calls.find(c => c[0] === '*')![1];
            responseHandler({ ok: true }, { 
                type: 'RESPONSE', 
                id: options!.id!, 
                meta: { correlationID: options!.id },
                timestamp: Date.now(),
                version: 1,
                priority: 1
            } as any);

            await rpcPromise;
            expect(mockNetwork.send).toHaveBeenCalledWith('forced-node', expect.any(String), expect.any(Object), expect.any(Object));
        });
    });

    describe('Middleware Pipeline', () => {
        const mockModule: IServiceModule = {
            domain: 'test',
            getContracts: () => [{
                domain: 'test',
                action: 'run',
                inputSchema: z.any(),
                outputSchema: z.any()
            }],
            execute: jest.fn().mockResolvedValue('success'),
        } as any;

        beforeEach(async () => {
            await broker.registerModule(mockModule);
        });

        it('should execute global middleware in order', async () => {
            const order: string[] = [];
            broker.use(async (ctx, next) => {
                order.push('m1-start');
                const res = await next();
                order.push('m1-end');
                return res;
            });
            broker.use(async (ctx, next) => {
                order.push('m2-start');
                const res = await next();
                order.push('m2-end');
                return res;
            });

            await broker.call('test.run', {} as any);
            expect(order).toEqual(['m1-start', 'm2-start', 'm2-end', 'm1-end']);
        });

        it('should execute local middleware only for local calls', async () => {
            const localOrder: string[] = [];
            broker.useLocal(async (ctx, next) => {
                localOrder.push('local');
                return next();
            });

            await broker.call('test.run', {} as any);
            expect(localOrder).toEqual(['local']);

            localOrder.length = 0;
            mockRegistry.selectNode.mockReturnValueOnce({ nodeID: 'remote' } as any);
            
            // Remote call
            const rpcPromise = broker.call('remote.tool', {} as any);
            const options = mockNetwork.send.mock.calls[0][3];
            const responseHandler = mockNetwork.onMessage.mock.calls.find(c => c[0] === '*')![1];
            responseHandler({ ok: true }, { 
                type: 'RESPONSE', 
                id: options!.id!, 
                meta: { correlationID: options!.id },
                timestamp: Date.now(),
                version: 1,
                priority: 1
            } as any);
            await rpcPromise;

            expect(localOrder).toEqual([]);
        });

        it('should allow middleware to modify context and params', async () => {
            broker.use(async (ctx, next) => {
                (ctx.params as any).injected = true;
                return next();
            });

            await broker.call('test.run', { original: true } as any);
            expect(mockModule.execute).toHaveBeenCalledWith('test', 'run', { original: true, injected: true }, expect.any(Object));
        });

        it('should allow middleware to abort the request', async () => {
            broker.use(async (ctx, next) => {
                return 'aborted';
            });

            const result = await broker.call('test.run', {} as any);
            expect(result).toBe('aborted');
            expect(mockModule.execute).not.toHaveBeenCalled();
        });

        it('should handle errors in middleware', async () => {
            broker.use(async () => {
                throw new Error('Middleware failure');
            });

            await expect(broker.call('test.run', {} as any)).rejects.toThrow('Middleware failure');
        });
    });

    describe('Event System', () => {
        it('should emit events locally and to the network', () => {
            const payload = { key: 'value' };
            broker.emit('test.event' as any, payload);

            expect(mockNetwork.publish).toHaveBeenCalledWith('test.event', payload);
        });

        it('should subscribe to local events', (done) => {
            const payload = { data: 123 };
            broker.on('user.created', (data) => {
                expect(data).toEqual(payload);
                done();
            });

            broker.emit('user.created' as any, payload);
        });

        it('should support pattern subscriptions (*)', (done) => {
            const payload = { data: 'pattern' };
            broker.on('order.*', (data, packet) => {
                expect(packet?.topic).toBe('order.shipped');
                expect(data).toEqual(payload);
                done();
            });

            broker.emit('order.shipped' as any, payload);
        });

        it('should unsubscribe from events', () => {
            const handler = jest.fn();
            const off = broker.on('temp.event', handler);
            off();

            broker.emit('temp.event' as any, {});
            expect(handler).not.toHaveBeenCalled();
        });

        it('should handle incoming network events', (done) => {
            const payload = { from: 'network' };
            broker.on('remote.event', (data) => {
                expect(data).toEqual(payload);
                done();
            });

            const responseHandler = mockNetwork.onMessage.mock.calls.find(c => c[0] === '*')![1];
            responseHandler(payload, {
                type: 'EVENT',
                topic: 'remote.event',
                data: payload,
                senderNodeID: 'other-node',
                id: 'pkt-1',
                timestamp: Date.now(),
                version: 1,
                priority: 1
            });
        });

        it('should skip network if options.skipNetwork is true', () => {
            broker.emit('local.only' as any, {}, { skipNetwork: true });
            expect(mockNetwork.publish).not.toHaveBeenCalled();
        });
    });

    describe('Plugin System', () => {
        it('should register a plugin and call onRegister', () => {
            const mockPlugin: IBrokerPlugin = {
                name: 'test-plugin',
                onRegister: jest.fn(),
                onStart: jest.fn(),
                onStop: jest.fn()
            };

            broker.pipe(mockPlugin);
            expect(mockPlugin.onRegister).toHaveBeenCalledWith(broker);
        });

        it('should call plugin onStart and onStop', async () => {
            const mockPlugin: IBrokerPlugin = {
                name: 'test-plugin',
                onRegister: jest.fn(),
                onStart: jest.fn(),
                onStop: jest.fn()
            };

            broker.pipe(mockPlugin);
            await broker.start();
            expect(mockPlugin.onStart).toHaveBeenCalled();

            await broker.stop();
            expect(mockPlugin.onStop).toHaveBeenCalled();
        });
    });

    describe('Lifecycle', () => {
        it('should cleanup pending requests on stop', async () => {
            mockRegistry.selectNode.mockReturnValue({ nodeID: 'remote' } as any);
            const rpcPromise = broker.call('remote.tool', {} as any);

            await broker.stop();
            await expect(rpcPromise).rejects.toThrow('Broker stopped');
        });

        it('should call onStart/onStop on registered modules', async () => {
            const onStart = jest.fn();
            const onStop = jest.fn();
            const mockModule: any = {
                domain: 'test',
                getContracts: () => [],
                onStart,
                onStop
            };

            await broker.registerModule(mockModule);
            await broker.start();
            expect(onStart).toHaveBeenCalled();

            await broker.stop();
            expect(onStop).toHaveBeenCalled();
        });

        it('should track started state', async () => {
            const onStart = jest.fn();
            const mockModule: any = {
                domain: 'test',
                getContracts: () => [],
                onStart
            };

            await broker.start();
            await broker.registerModule(mockModule);
            expect(onStart).toHaveBeenCalled();
        });
    });

    describe('Dependency Injection', () => {
        it('should register and retrieve providers', () => {
            const provider = { service: 'db' };
            broker.registerProvider('database', provider);
            expect(broker.getProvider('database')).toBe(provider);
        });

        it('should return undefined for non-existent provider', () => {
            expect(broker.getProvider('missing')).toBeUndefined();
        });
    });

    describe('Context Management', () => {
        it('should provide context within a call', async () => {
            const mockModule: any = {
                domain: 'test',
                getContracts: () => [{ domain: 'test', action: 'ctx', inputSchema: z.any() }],
                execute: async () => {
                    const ctx = broker.getContext();
                    return ctx?.toolName;
                }
            };
            await broker.registerModule(mockModule);
            const res = await broker.call('test.ctx', {} as any);
            expect(res).toBe('test.ctx');
        });

        it('should propagate correlationID', async () => {
            const correlationID = 'fixed-id';
            const mockModule: any = {
                domain: 'test',
                getContracts: () => [{ domain: 'test', action: 'sub', inputSchema: z.any() }],
                execute: async () => {
                    return broker.getContext()?.correlationID;
                }
            };
            await broker.registerModule(mockModule);

            broker.use(async (ctx, next) => {
                (ctx as any).correlationID = correlationID;
                return next();
            });

            const res = await broker.call('test.sub', {} as any);
            expect(res).toBe(correlationID);
        });
    });

    describe('Edge Cases & Error Handling', () => {
        it('should handle incoming RPC for non-existent local tool', async () => {
            const packet: IMeshPacket = {
                id: 'req-1',
                topic: 'missing.tool',
                data: {},
                senderNodeID: 'sender',
                type: 'REQUEST',
                timestamp: Date.now(),
                version: 1,
                priority: 1
            };

            await broker.handleIncomingRPC(packet).catch(err => {
                expect(err.message).toContain('Local tool not found');
            });
        });

        it('should handle incoming RPC and send response', async () => {
            const mockModule: any = {
                domain: 'test',
                getContracts: () => [{ domain: 'test', action: 'echo', inputSchema: z.any() }],
                execute: async (d: any, a: any, p: any) => p
            };
            await broker.registerModule(mockModule);

            const packet: IMeshPacket = {
                id: 'req-echo',
                topic: 'test.echo',
                data: { hello: 'world' },
                senderNodeID: 'sender-node',
                type: 'REQUEST',
                timestamp: Date.now(),
                version: 1,
                priority: 1
            };

            const responseHandler = mockNetwork.onMessage.mock.calls.find(c => c[0] === '*')![1];
            responseHandler(packet.data, packet);

            // Wait for async handler
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(mockNetwork.send).toHaveBeenCalledWith(
                'sender-node',
                'test.echo',
                { hello: 'world' },
                expect.objectContaining({ type: 'RESPONSE', meta: expect.objectContaining({ correlationID: 'req-echo' }) })
            );
        });

        it('should handle incoming RPC errors and send RESPONSE_ERROR', async () => {
            const packet: IMeshPacket = {
                id: 'req-fail',
                topic: 'test.fail',
                data: {},
                senderNodeID: 'sender-node',
                type: 'REQUEST',
                timestamp: Date.now(),
                version: 1,
                priority: 1
            };

            const responseHandler = mockNetwork.onMessage.mock.calls.find(c => c[0] === '*')![1];
            responseHandler(packet.data, packet);

            // Wait for async handler
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(mockNetwork.send).toHaveBeenCalledWith(
                'sender-node',
                'test.fail',
                expect.any(Object),
                expect.objectContaining({ type: 'RESPONSE_ERROR' })
            );
        });
    });
});
