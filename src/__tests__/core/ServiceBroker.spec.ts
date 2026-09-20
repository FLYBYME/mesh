import { createTestApp, destroyTestApp, dropTestCollection, TEST_DB_NAME, withTestDatabase } from '../helpers/setup.js';
import { MeshApp } from '../../core/MeshApp.js';
import { IServiceBroker } from '../../interfaces/IServiceBroker.js';
import { IServiceContext } from '../../interfaces/IServiceContext.js';
import { ServiceBroker } from '../../core/ServiceBroker.js';
import { defineContract } from '../../interfaces/IToolContract.js';
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

    // ─── per-domain database override ────────────────────────────────────────
    // CRUD calls flow through DatabaseMiddleware, which is otherwise tied to one shared
    // Database/Mongo connection for the whole broker -- so "this collection lives somewhere else"
    // had no way to be said at all.
    //
    // This used to be `registerModule`'s `database` option, and was tested alongside an *aliased
    // mount*: the same module mounted twice, once as `widget` and once as `test:widget`, each with
    // its own Database. Aliasing does not survive contracts -- a contract *is* its domain, and
    // mounting the same contracts under a second local prefix only meant anything while a module
    // was a reusable instance. The database override does survive, at the granularity that was
    // always more honest: per domain, not per whatever mounted it.
    describe('registerContract() — per-domain database override', () => {
        const WidgetSchema = z.object({
            name: z.string(),
            createdAt: z.coerce.date(),
            updatedAt: z.coerce.date(),
        });
        const isolatedCrud = defineCrud('isolatedWidget', WidgetSchema, {
            dependencies: [], filePath: 'src/__tests__/core/ServiceBroker.spec.ts', permissions: [],
        });

        it("routes a domain's CRUD calls to its own Database, never touching the shared default", async () => {
            const testDbName = `mesh_test_dbiso_${Math.random().toString(36).slice(2, 8)}`;
            // Database's constructor lets the URI's own path override an explicit `dbName` --
            // the URI must actually embed the target db name, same as createTestApp does.
            const isolatedUri = withTestDatabase(process.env.MONGODB_URI!, testDbName);
            const testDb = new Database(app.logger, isolatedUri, testDbName);
            await testDb.connect();

            (broker as ServiceBroker).registerCrud(isolatedCrud, { database: testDb });

            try {
                const row = await broker.call('isolatedWidget.create' as never, { name: 'isolated-widget' } as never) as unknown as { id: string };

                // Readable through its own contracts, as any collection is.
                const found = await broker.call('isolatedWidget.find' as never, {} as never) as unknown as { name: string }[];
                expect(found.map((i) => i.name)).toContain('isolated-widget');

                // The real proof, against raw Mongo: the row is in the isolated database and is
                // *not* in the broker's default one, which is where it would have landed without
                // the override. Two logical views over one store would fail this.
                const rawClient = new MongoClient(process.env.MONGODB_URI!);
                await rawClient.connect();
                try {
                    const isolatedDocs = await rawClient.db(testDbName).collection('isolatedWidget').find({}).toArray();
                    const defaultDocs = await rawClient.db(TEST_DB_NAME).collection('isolatedWidget').find({}).toArray();

                    expect(isolatedDocs.map((d) => d.name)).toContain('isolated-widget');
                    expect(defaultDocs.find((d) => d.id === row.id)).toBeUndefined();
                    expect(defaultDocs).toHaveLength(0);

                    await rawClient.db(testDbName).dropDatabase();
                } finally {
                    await rawClient.close();
                }
            } finally {
                for (const action of ['find', 'find_one', 'count', 'get', 'resolve', 'create', 'create_many', 'update', 'replace', 'delete']) {
                    (broker as ServiceBroker).unregisterContract(`isolatedWidget.${action}`);
                }
                await testDb.disconnect();
            }
        });
    });
});
