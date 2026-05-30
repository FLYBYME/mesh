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
            const doc = await broker.call('demo.create', { name: 'Pipeline Item', value: 42 });
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
            await broker.call('demo.create', { name: 'Alpha', value: 10 });
            await broker.call('demo.create', { name: 'Beta', value: 50 });
            await broker.call('demo.create', { name: 'Gamma', value: 30 });
            await broker.call('demo.create', { name: 'Delta', value: 5 });
            await broker.call('demo.create', { name: 'Epsilon', value: 100 });
            // Small delay for eventual consistency on remote clusters
            await new Promise(resolve => setTimeout(resolve, 200));
        });

        it('should return all documents', async () => {
            const results = await broker.call('demo.find', {});
            expect(results).toHaveLength(5);
        });

        it('should sort results ascending and descending', async () => {
            const asc = await broker.call('demo.find', { sort: 'value' });
            expect(asc[0].name).toBe('Delta');
            expect(asc[4].name).toBe('Epsilon');

            const desc = await broker.call('demo.find', { sort: '-value' });
            expect(desc[0].name).toBe('Epsilon');
            expect(desc[4].name).toBe('Delta');
        });

        it('should filter using advanced query objects', async () => {
            const results = await broker.call('demo.find', { 
                query: { value: { $gt: 40 } } 
            });
            expect(results).toHaveLength(2); // Beta (50) and Epsilon (100)
            const names = results.map(r => r.name);
            expect(names).toContain('Beta');
            expect(names).toContain('Epsilon');
        });

        it('should apply limit and offset', async () => {
            const results = await broker.call('demo.find', { limit: 2, sort: 'value' });
            expect(results).toHaveLength(2);
            expect(results[0].name).toBe('Delta');

            const offsetResults = await broker.call('demo.find', { limit: 2, offset: 2, sort: 'value' });
            expect(offsetResults).toHaveLength(2);
            expect(offsetResults[0].name).toBe('Gamma'); // Sorted: Delta(5), Alpha(10), Gamma(30)...
        });
    });

    // ─── find_one ────────────────────────────────────────────────────────────

    describe('demo.find_one', () => {
        beforeEach(async () => {
            for (let i = 0; i < 10; i++) {
                await broker.call('demo.create', { name: `One ${i}`, value: i });
            }
            // Small delay for eventual consistency on remote clusters
            await new Promise(resolve => setTimeout(resolve, 200));
        });

        it('should return a single document', async () => {
            const result = await broker.call('demo.find_one', { query: { name: 'One 3' } });
            expect(result).toBeDefined();
            expect(result?.name).toBe('One 3');
        });

        it('should apply offset (BUG FIX VALIDATION)', async () => {
            const first = await broker.call('demo.find_one', { sort: 'value', offset: 0 });
            const sixth = await broker.call('demo.find_one', { sort: 'value', offset: 5 });
            expect(first).toBeDefined();
            expect(sixth).toBeDefined();
            expect(first?.id).not.toBe(sixth?.id);
        });

        it('should return different documents for different offsets', async () => {
            const ids = new Set<string>();
            for (let i = 0; i < 10; i++) {
                const result = await broker.call('demo.find_one', { sort: 'value', offset: i });
                expect(result).toBeDefined();
                if (result) ids.add(result.id);
            }
            expect(ids.size).toBe(10);
        });
    });

    // ─── count ───────────────────────────────────────────────────────────────

    describe('demo.count', () => {
        it('should return 0 for empty collection', async () => {
            const count = await broker.call('demo.count', {});
            expect(count).toBe(0);
        });

        it('should return correct count after inserts', async () => {
            for (let i = 0; i < 3; i++) {
                await broker.call('demo.create', { name: `Count ${i}`, value: i });
            }
            // Small delay for eventual consistency on remote clusters
            await new Promise(resolve => setTimeout(resolve, 200));
            const count = await broker.call('demo.count', {});
            expect(count).toBe(3);
        });
    });

    // ─── get ─────────────────────────────────────────────────────────────────

    describe('demo.get', () => {
        it('should retrieve a document by ID', async () => {
            const created = await broker.call('demo.create', { name: 'Get Me', value: 99 });
            const fetched = await broker.call('demo.get', { id: created.id });
            expect(fetched.id).toBe(created.id);
            expect(fetched.name).toBe('Get Me');
        });
    });

    // ─── update ──────────────────────────────────────────────────────────────

    describe('demo.update', () => {
        it('should update a document through the pipeline', async () => {
            const created = await broker.call('demo.create', { name: 'Before', value: 1 });
            const updated = await broker.call('demo.update', { id: created.id, name: 'After' });
            expect(updated.name).toBe('After');
            expect(updated.value).toBe(1);
        });
    });

    // ─── delete ──────────────────────────────────────────────────────────────

    describe('demo.delete', () => {
        it('should delete a document and return success', async () => {
            const created = await broker.call('demo.create', { name: 'Delete Me', value: 0 });
            const result = await broker.call('demo.delete', { id: created.id });
            expect(result.success).toBe(true);
        });
    });

    // ─── events ──────────────────────────────────────────────────────────────

    describe('CRUD events', () => {
        it('should emit data.created when a document is created', async () => {
            const events: Record<string, any>[] = [];
            broker.on('data.created', (payload) => events.push(payload));

            await broker.call('demo.create', { name: 'Evented', value: 1 });

            // Events fire synchronously on the broker's local EventEmitter
            expect(events.length).toBeGreaterThanOrEqual(1);
            const lastEvent = events[events.length - 1];
            expect(lastEvent.domain).toBe('demo');
            expect(lastEvent.id).toBeDefined();
        });
    });
});
