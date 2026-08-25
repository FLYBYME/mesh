import { createTestApp, destroyTestApp, dropTestCollection } from '../helpers/setup.js';
import { MeshApp } from '../../core/MeshApp.js';
import { IServiceBroker } from '../../interfaces/IServiceBroker.js';
import { IServiceModule } from '../../interfaces/IServiceModule.js';
import { IServiceContext } from '../../interfaces/IServiceContext.js';
import { ServiceBroker } from '../../core/ServiceBroker.js';
import { ServiceModule } from '../../core/ServiceModule.js';
import { defaultPrint, defineContract } from '../../interfaces/IToolContract.js';
import { z } from 'zod';

describe('ServiceBroker', () => {
    let app: MeshApp;
    let broker: IServiceBroker;

    beforeAll(async () => {
        await dropTestCollection('demo');
        app = await createTestApp('broker-test-node');
        broker = app.getProvider<IServiceBroker>('broker');
    });

    afterAll(async () => {
        await destroyTestApp(app);
        const { dropTestDatabase } = await import('../helpers/setup.js');
        await dropTestDatabase();
    });

    // ─── local call ──────────────────────────────────────────────────────────

    describe('call() — local tools', () => {
        it('should call demo.hello and return a greeting', async () => {
            const result = await broker.call('demo.hello', { name: 'World' });
            expect(result.message).toBe('Hello, World! Event dispatched and metric recorded!');
        });

        it('should call demo.status and return health info', async () => {
            const result = await broker.call('demo.status', { name: 'Test' });
            expect(result.message).toContain('Test');
            expect(result.message).toContain('Healthy');
        });

        it('should propagate metadata from options to context', async () => {
            let capturedMeta: any = null;
            broker.use(async (ctx, next) => {
                if (ctx.toolName === 'demo.status') {
                    capturedMeta = ctx.meta;
                }
                return next();
            });

            await broker.call('demo.status', { name: 'MetaTest' }, {
                meta: { customValue: '123' } as any
            });

            expect(capturedMeta).toBeDefined();
            expect(capturedMeta.customValue).toBe('123');
        });
    });

    // ─── Zod validation ─────────────────────────────────────────────────────

    describe('call() — input validation', () => {
        it('should reject invalid params with Zod error', async () => {
            await expect(
                broker.call('demo.hello', { name: 123 } as any)
            ).rejects.toThrow();
        });

        it('should reject missing required fields', async () => {
            await expect(
                broker.call('demo.hello', {} as any)
            ).rejects.toThrow();
        });
    });

    // ─── middleware ──────────────────────────────────────────────────────────

    describe('middleware chain', () => {
        it('should execute middleware in order', async () => {
            const order: string[] = [];

            broker.use(async (_ctx, next) => {
                order.push('global-1');
                const result = await next();
                order.push('global-1-after');
                return result;
            });

            await broker.call('demo.hello', { name: 'MW' });

            expect(order).toContain('global-1');
            expect(order).toContain('global-1-after');
            expect(order.indexOf('global-1')).toBeLessThan(order.indexOf('global-1-after'));
        });
    });

    // ─── events ──────────────────────────────────────────────────────────────

    describe('emit() / on()', () => {
        it('should emit and receive events', () => {
            const received: any[] = [];
            broker.on('test.event', (payload) => received.push(payload));
            broker.emit('test.event', { data: 'hello' });
            expect(received).toHaveLength(1);
            expect((received[0] as Record<string, unknown>).data).toBe('hello');
        });

        it('should support wildcard event patterns', () => {
            const received: any[] = [];
            broker.on('test.*' as any, (payload) => received.push(payload));
            broker.emit('test.foo', { a: 1 });
            broker.emit('test.bar', { b: 2 });
            expect(received).toHaveLength(2);
        });

        it('should support unsubscribe via returned function', () => {
            const received: any[] = [];
            const unsub = broker.on('unsub.test', (payload) => received.push(payload));
            broker.emit('unsub.test', { first: true });
            unsub();
            broker.emit('unsub.test', { second: true });
            expect(received).toHaveLength(1);
        });
    });

    // ─── lifecycle ───────────────────────────────────────────────────────────

    describe('start() / stop()', () => {
        it('should start and stop without errors', async () => {
            const testBroker = new ServiceBroker('lifecycle-test', app.logger);
            await testBroker.start();
            await testBroker.stop();
        });
    });

    // ─── unregisterModule() — real dynamic service lifecycle ──────────────────
    // See docs/SUPERVISOR_AND_SERVICE_LIFECYCLE.md Part 1. The load-bearing claim
    // being tested here isn't "the code ran without throwing" -- it's that a
    // service's own resources (a live timer, in this case) are genuinely released,
    // and that removal doesn't disturb anything else still registered.

    describe('unregisterModule()', () => {
        const tickContract = defineContract({
            domain: 'ticker',
            action: 'tick_count',
            description: 'Returns how many times the internal timer has ticked.',
            inputSchema: z.object({}),
            outputSchema: z.object({ count: z.number() }),
            rest: { method: 'POST', path: '/ticker/tick_count' },
            destructive: false,
            print: defaultPrint,
        });

        class TickerModule extends ServiceModule {
            public readonly domain = 'ticker';
            public tickCount = 0;
            public stopCalled = false;
            public receivedEvents: unknown[] = [];
            private timer?: ReturnType<typeof setInterval>;

            constructor() {
                super();
                this.mountTool(tickContract, async () => ({ count: this.tickCount }));
                this.mountEventHandler('test.event', (payload) => {
                    this.receivedEvents.push(payload);
                });
            }

            public async onStart(): Promise<void> {
                this.timer = setInterval(() => { this.tickCount++; }, 10);
            }

            public async onStop(): Promise<void> {
                this.stopCalled = true;
                if (this.timer) {
                    clearInterval(this.timer);
                    this.timer = undefined;
                }
            }
        }

        it('calls onStop, stops a live timer for real, removes tools/schema/events, and leaves other modules untouched', async () => {
            const ticker = new TickerModule();
            await (broker as ServiceBroker).registerModule(ticker as unknown as IServiceModule);
            // Broker-level registerModule doesn't call onStart itself unless the broker
            // is already started -- this test app's broker is, via app.start() in setup.
            await new Promise((resolve) => setTimeout(resolve, 55));
            const midCount = (await broker.call('ticker.tick_count' as never, {} as never)) as unknown as { count: number };
            expect(midCount.count).toBeGreaterThan(0);

            // A still-registered, unrelated tool works fine before we touch anything.
            const before = await broker.call('demo.hello', { name: 'Untouched' });
            expect(before.message).toContain('Untouched');

            await (broker as ServiceBroker).unregisterModule('ticker');

            expect(ticker.stopCalled).toBe(true);
            const countAtUnregister = ticker.tickCount;
            await new Promise((resolve) => setTimeout(resolve, 55));
            // The real assertion: the interval genuinely stopped firing, not just that
            // onStop was called (a service could call onStop and still leak a timer if
            // the framework didn't actually clear it -- this proves the whole chain).
            expect(ticker.tickCount).toBe(countAtUnregister);

            // The tool is really gone, not just quietly failing some other way.
            await expect(broker.call('ticker.tick_count' as never, {} as never)).rejects.toThrow(/not found/i);

            // Emitting the event this module was subscribed to must not touch it anymore.
            const receivedBefore = ticker.receivedEvents.length;
            broker.emit('test.event', { data: 'after-unregister' });
            expect(ticker.receivedEvents.length).toBe(receivedBefore);

            // A completely different, still-registered service is unaffected throughout.
            const after = await broker.call('demo.hello', { name: 'StillHere' });
            expect(after.message).toContain('StillHere');
        });

        it('throws a real error when unregistering a domain that was never registered', async () => {
            await expect((broker as ServiceBroker).unregisterModule('never-registered')).rejects.toThrow(/not registered/i);
        });
    });

    // ─── registerModule() mount keys — coexisting instances of the same domain ─
    // A single Supervisor process needs to be able to run an isolated test-namespace
    // instance of a service alongside the real one (docs/SUPERVISOR_AND_SERVICE_LIFECYCLE.md,
    // Part 3's prerequisite). The real blocker was that localTools/MeshToolSchemaRegistry are
    // keyed by `${domain}.${action}` with no room for a second instance -- these tests prove
    // registerModule's `key` option resolves that for real: independent instance state, a
    // module that owns *two* real domains (mirroring `demo`/`demometrics`) aliases both without
    // collision, a colliding mount key is rejected, and an aliased mount is genuinely invisible
    // to the Registry (local-only, can't be routed to remotely or collide with the real entry).
    describe('registerModule() — mount keys / aliased instances', () => {
        const primaryPingContract = defineContract({
            domain: 'md-primary',
            action: 'ping',
            description: 'Multi-domain module fixture -- primary domain.',
            inputSchema: z.object({}),
            outputSchema: z.object({ instanceId: z.string() }),
            rest: { method: 'GET', path: '/md-primary/ping' },
            print: defaultPrint,
        });

        const secondaryPingContract = defineContract({
            domain: 'md-secondary',
            action: 'ping',
            description: 'Multi-domain module fixture -- secondary domain owned by the same module (mirrors demo/demometrics).',
            inputSchema: z.object({}),
            outputSchema: z.object({ instanceId: z.string() }),
            rest: { method: 'GET', path: '/md-secondary/ping' },
            print: defaultPrint,
        });

        class MultiDomainModule extends ServiceModule {
            public readonly domain = 'md-primary';
            public readonly instanceId = Math.random().toString(36).slice(2);

            constructor() {
                super();
                this.mountTool(primaryPingContract, async () => ({ instanceId: this.instanceId }));
                this.mountTool(secondaryPingContract, async () => ({ instanceId: this.instanceId }));
            }
        }

        it('lets two instances of the same domain coexist under different mount keys, aliasing every real domain the module owns', async () => {
            const real = new MultiDomainModule();
            const test = new MultiDomainModule();

            await (broker as ServiceBroker).registerModule(real as unknown as IServiceModule);
            await (broker as ServiceBroker).registerModule(test as unknown as IServiceModule, { key: 'md-test' });

            const realPrimary = (await broker.call('md-primary.ping' as never, {} as never)) as unknown as { instanceId: string };
            const realSecondary = (await broker.call('md-secondary.ping' as never, {} as never)) as unknown as { instanceId: string };
            expect(realPrimary.instanceId).toBe(real.instanceId);
            expect(realSecondary.instanceId).toBe(real.instanceId);

            const testPrimary = (await broker.call('md-test.ping' as never, {} as never)) as unknown as { instanceId: string };
            const testSecondary = (await broker.call('md-test:md-secondary.ping' as never, {} as never)) as unknown as { instanceId: string };
            expect(testPrimary.instanceId).toBe(test.instanceId);
            expect(testSecondary.instanceId).toBe(test.instanceId);
            expect(testPrimary.instanceId).not.toBe(realPrimary.instanceId);

            // Aliased mount is local-only: never advertised to the Registry.
            expect(app.registry.findNodesForTool('md-test.ping')).toHaveLength(0);
            expect(app.registry.findNodesForTool('md-primary.ping').length).toBeGreaterThan(0);

            // A third registration colliding on the same mount key is a real, rejected conflict.
            await expect(
                (broker as ServiceBroker).registerModule(new MultiDomainModule() as unknown as IServiceModule, { key: 'md-test' })
            ).rejects.toThrow(/mount key "md-test" is already in use/i);

            // Unregistering the aliased instance leaves the real one completely untouched.
            await (broker as ServiceBroker).unregisterModule('md-test');
            await expect(broker.call('md-test.ping' as never, {} as never)).rejects.toThrow(/not found/i);
            const stillReal = (await broker.call('md-primary.ping' as never, {} as never)) as unknown as { instanceId: string };
            expect(stillReal.instanceId).toBe(real.instanceId);

            await (broker as ServiceBroker).unregisterModule('md-primary');
        });
    });
});
