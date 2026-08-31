import { createTestApp, destroyTestApp, dropTestCollection, TEST_DB_NAME, withTestDatabase } from '../helpers/setup.js';
import { MeshApp } from '../../core/MeshApp.js';
import { IServiceBroker } from '../../interfaces/IServiceBroker.js';
import { IServiceModule } from '../../interfaces/IServiceModule.js';
import { IServiceContext } from '../../interfaces/IServiceContext.js';
import { ServiceBroker } from '../../core/ServiceBroker.js';
import { ServiceModule } from '../../core/ServiceModule.js';
import { defaultPrint, defineContract } from '../../interfaces/IToolContract.js';
import { defineCrud } from '../../interfaces/ICrudContract.js';
import { Database } from '../../db/Database.js';
import { MongoClient } from 'mongodb';
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

        // Real regression test: found when pulling this change into a real downstream project
        // (`paas`) broke 18 previously-passing test suites. Multiple distinct modules legitimately
        // share one real `domain`, each contributing different, non-overlapping actions to that
        // domain's shared tool namespace (e.g. a base service + an "edge" extension of it, both
        // `domain: 's3'`) -- this always silently worked pre-mount-keys, and must keep working:
        // the mount-key conflict check must only guard the *aliased* path (a genuinely new
        // capability with nothing to preserve), never the default/unaliased one.
        it('still lets two distinct, unaliased modules share one real domain, each contributing different actions', async () => {
            const otherPingContract = defineContract({
                domain: 'md-primary',
                action: 'other',
                description: 'A second module sharing md-primary\'s domain, contributing a different action.',
                inputSchema: z.object({}),
                outputSchema: z.object({ ok: z.boolean() }),
                rest: { method: 'GET', path: '/md-primary/other' },
                print: defaultPrint,
            });

            class OtherModule extends ServiceModule {
                public readonly domain = 'md-primary';
                constructor() {
                    super();
                    this.mountTool(otherPingContract, async () => ({ ok: true }));
                }
            }

            const first = new MultiDomainModule();
            const second = new OtherModule();

            await expect(
                (broker as ServiceBroker).registerModule(first as unknown as IServiceModule)
            ).resolves.not.toThrow();
            await expect(
                (broker as ServiceBroker).registerModule(second as unknown as IServiceModule)
            ).resolves.not.toThrow();

            const pingResult = (await broker.call('md-primary.ping' as never, {} as never)) as unknown as { instanceId: string };
            expect(pingResult.instanceId).toBe(first.instanceId);
            const otherResult = (await broker.call('md-primary.other' as never, {} as never)) as unknown as { ok: boolean };
            expect(otherResult.ok).toBe(true);

            await (broker as ServiceBroker).unregisterModule('md-primary');
        });
    });

    // ─── registerModule() database override — real per-mount DB isolation ─────
    // The mount-key fix above only solves the *tool key* collision. CRUD calls all flow
    // through DatabaseMiddleware, which was tied to one shared Database/Mongo connection for
    // the whole broker regardless of mount key -- a test-mounted instance would still write into
    // the real production database. These tests prove registerModule's `database` option fixes
    // that for real: a mount-keyed instance backed by its own Database genuinely writes to and
    // reads from a separate Mongo database, verified both through the CRUD contracts themselves
    // and by inspecting the raw underlying Mongo collections directly.
    describe('registerModule() — per-mount database override', () => {
        const WidgetSchema = z.object({
            name: z.string(),
            createdAt: z.coerce.date(),
            updatedAt: z.coerce.date(),
        });
        const widgetCrud = defineCrud('widget', WidgetSchema, { dependencies: [] });

        class WidgetModule extends ServiceModule {
            public readonly domain = 'widget';
            constructor() {
                super();
                this.mountCrud(widgetCrud);
            }
        }

        it("routes a mount-keyed instance's CRUD calls to its own Database, fully isolated from the shared default", async () => {
            const testDbName = `mesh_test_dbiso_${Math.random().toString(36).slice(2, 8)}`;
            // Database's constructor lets the URI's own path override an explicit `dbName` --
            // the URI must actually embed the target db name, same as createTestApp does.
            const isolatedUri = withTestDatabase(process.env.MONGODB_URI!, testDbName);
            const testDb = new Database(app.logger, isolatedUri, testDbName);
            await testDb.connect();

            await (broker as ServiceBroker).registerModule(new WidgetModule() as unknown as IServiceModule);
            await (broker as ServiceBroker).registerModule(new WidgetModule() as unknown as IServiceModule, {
                key: 'test:widget',
                database: testDb,
            });

            try {
                const real = await broker.call('widget.create' as never, { name: 'real-widget' } as never) as unknown as { id: string };
                const test = await broker.call('test:widget.create' as never, { name: 'test-widget' } as never) as unknown as { id: string };

                // Through the contracts: each mount only ever sees its own data.
                const realFind = await broker.call('widget.find' as never, {} as never) as unknown as { name: string }[];
                const testFind = await broker.call('test:widget.find' as never, {} as never) as unknown as { name: string }[];
                expect(realFind.map((i) => i.name)).toContain('real-widget');
                expect(realFind.map((i) => i.name)).not.toContain('test-widget');
                expect(testFind.map((i) => i.name)).toContain('test-widget');
                expect(testFind.map((i) => i.name)).not.toContain('real-widget');

                // Directly against the raw Mongo collections: the real proof that this isn't
                // just two logical views over the same underlying storage. One shared client for
                // both the check and the cleanup below, to minimize extra connection churn
                // alongside the rest of the suite's own parallel Mongo usage.
                const rawClient = new MongoClient(process.env.MONGODB_URI!);
                await rawClient.connect();
                try {
                    const defaultDocs = await rawClient.db(TEST_DB_NAME).collection('widget').find({}).toArray();
                    const isolatedDocs = await rawClient.db(testDbName).collection('widget').find({}).toArray();

                    expect(defaultDocs.map((d) => d.name)).toContain('real-widget');
                    expect(defaultDocs.map((d) => d.name)).not.toContain('test-widget');
                    expect(defaultDocs.find((d) => d.id === test.id)).toBeUndefined();

                    expect(isolatedDocs.map((d) => d.name)).toContain('test-widget');
                    expect(isolatedDocs.map((d) => d.name)).not.toContain('real-widget');
                    expect(isolatedDocs.find((d) => d.id === real.id)).toBeUndefined();

                    await rawClient.db(testDbName).dropDatabase();
                } finally {
                    await rawClient.close();
                }
            } finally {
                await (broker as ServiceBroker).unregisterModule('test:widget');
                await (broker as ServiceBroker).unregisterModule('widget');
                await testDb.disconnect();
            }
        });
    });
});
