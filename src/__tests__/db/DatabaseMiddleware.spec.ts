import { createTestApp, destroyTestApp, dropTestCollection } from '../helpers/setup.js';
import { MeshApp } from '../../core/MeshApp.js';
import { IServiceBroker } from '../../interfaces/IServiceBroker.js';

describe('DatabaseMiddleware (full pipeline)', () => {
    let app: MeshApp;
    let broker: IServiceBroker;

    beforeAll(async () => {
        await dropTestCollection('demo');
        app = await createTestApp('middleware-test-node');
        broker = app.getProvider<IServiceBroker>('broker');
    });

    afterAll(async () => {
        await destroyTestApp(app);
        const { dropTestDatabase } = await import('../helpers/setup.js');
        await dropTestDatabase();
    });

    beforeEach(async () => {
        await dropTestCollection('demo');
    });

    // ─── create ──────────────────────────────────────────────────────────────

    describe('demo.create', () => {
        it('should create a document through the full pipeline', async () => {
            const result = await broker.call('demo.create' as never, { name: 'Pipeline Item', value: 42 } as never);
            const doc = result as Record<string, unknown>;
            expect(doc.name).toBe('Pipeline Item');
            expect(doc.value).toBe(42);
            expect(doc.id).toBeDefined();
            expect(doc.createdAt).toBeDefined();
            expect(doc.updatedAt).toBeDefined();
        });
    });

    // ─── find ────────────────────────────────────────────────────────────────

    describe('demo.find', () => {
        beforeEach(async () => {
            for (let i = 0; i < 5; i++) {
                await broker.call('demo.create' as never, { name: `Find ${i}`, value: i } as never);
            }
            // Small delay for eventual consistency on remote clusters
            await new Promise(resolve => setTimeout(resolve, 200));
        });

        it('should return all documents', async () => {
            const results = await broker.call('demo.find' as never, {} as never) as unknown[];
            expect(results).toHaveLength(5);
        });

        it('should filter by query', async () => {
            const results = await broker.call('demo.find' as never, { query: { name: 'Find 2' } } as never) as unknown[];
            expect(results).toHaveLength(1);
            expect((results[0] as Record<string, unknown>).name).toBe('Find 2');
        });

        it('should apply limit', async () => {
            const results = await broker.call('demo.find' as never, { limit: 2 } as never) as unknown[];
            expect(results).toHaveLength(2);
        });
    });

    // ─── find_one ────────────────────────────────────────────────────────────

    describe('demo.find_one', () => {
        beforeEach(async () => {
            for (let i = 0; i < 10; i++) {
                await broker.call('demo.create' as never, { name: `One ${i}`, value: i } as never);
            }
            // Small delay for eventual consistency on remote clusters
            await new Promise(resolve => setTimeout(resolve, 200));
        });

        it('should return a single document', async () => {
            const result = await broker.call('demo.find_one' as never, { query: { name: 'One 3' } } as never) as Record<string, unknown>;
            expect(result).toBeDefined();
            expect(result.name).toBe('One 3');
        });

        it('should apply offset (BUG FIX VALIDATION)', async () => {
            const first = await broker.call('demo.find_one' as never, { sort: 'value', offset: 0 } as never) as Record<string, unknown>;
            const sixth = await broker.call('demo.find_one' as never, { sort: 'value', offset: 5 } as never) as Record<string, unknown>;
            expect(first).toBeDefined();
            expect(sixth).toBeDefined();
            expect(first.id).not.toBe(sixth.id);
        });

        it('should return different documents for different offsets', async () => {
            const ids = new Set<string>();
            for (let i = 0; i < 10; i++) {
                const result = await broker.call('demo.find_one' as never, { sort: 'value', offset: i } as never) as Record<string, unknown>;
                expect(result).toBeDefined();
                ids.add(result.id as string);
            }
            expect(ids.size).toBe(10);
        });
    });

    // ─── count ───────────────────────────────────────────────────────────────

    describe('demo.count', () => {
        it('should return 0 for empty collection', async () => {
            const count = await broker.call('demo.count' as never, {} as never);
            expect(count).toBe(0);
        });

        it('should return correct count after inserts', async () => {
            for (let i = 0; i < 3; i++) {
                await broker.call('demo.create' as never, { name: `Count ${i}`, value: i } as never);
            }
            // Small delay for eventual consistency on remote clusters
            await new Promise(resolve => setTimeout(resolve, 200));
            const count = await broker.call('demo.count' as never, {} as never);
            expect(count).toBe(3);
        });
    });

    // ─── get ─────────────────────────────────────────────────────────────────

    describe('demo.get', () => {
        it('should retrieve a document by ID', async () => {
            const created = await broker.call('demo.create' as never, { name: 'Get Me', value: 99 } as never) as Record<string, unknown>;
            const fetched = await broker.call('demo.get' as never, { id: created.id } as never) as Record<string, unknown>;
            expect(fetched.id).toBe(created.id);
            expect(fetched.name).toBe('Get Me');
        });
    });

    // ─── update ──────────────────────────────────────────────────────────────

    describe('demo.update', () => {
        it('should update a document through the pipeline', async () => {
            const created = await broker.call('demo.create' as never, { name: 'Before', value: 1 } as never) as Record<string, unknown>;
            const updated = await broker.call('demo.update' as never, { id: created.id, name: 'After' } as never) as Record<string, unknown>;
            expect(updated.name).toBe('After');
            expect(updated.value).toBe(1);
        });
    });

    // ─── delete ──────────────────────────────────────────────────────────────

    describe('demo.delete', () => {
        it('should delete a document and return success', async () => {
            const created = await broker.call('demo.create' as never, { name: 'Delete Me', value: 0 } as never) as Record<string, unknown>;
            const result = await broker.call('demo.delete' as never, { id: created.id } as never) as Record<string, unknown>;
            expect(result.success).toBe(true);
        });
    });

    // ─── events ──────────────────────────────────────────────────────────────

    describe('CRUD events', () => {
        it('should emit data.created when a document is created', async () => {
            const events: unknown[] = [];
            broker.on('data.created', (payload: unknown) => events.push(payload));

            await broker.call('demo.create' as never, { name: 'Evented', value: 1 } as never);

            // Events fire synchronously on the broker's local EventEmitter
            expect(events.length).toBeGreaterThanOrEqual(1);
            const lastEvent = events[events.length - 1] as Record<string, unknown>;
            expect(lastEvent.domain).toBe('demo');
            expect(lastEvent.id).toBeDefined();
        });
    });
});
