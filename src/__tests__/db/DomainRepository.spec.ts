import { MongoClient, Collection, Document, ObjectId } from 'mongodb';
import { z } from 'zod';
import { DomainRepository } from '../../db/DomainRepository.js';
import { TEST_DB_NAME } from '../helpers/setup.js';
import { withTestDatabase } from '../../testing/TestHelpers.js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true } as any);

const ItemSchema = z.object({
    id: z.string(),
    name: z.string(),
    value: z.number(),
    category: z.string().optional(),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
});
type Item = z.infer<typeof ItemSchema>;

describe('DomainRepository', () => {
    let client: MongoClient;
    let collection: Collection<Document>;
    let repo: DomainRepository<Item>;

    beforeAll(async () => {
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
        const baseUri = withTestDatabase(mongoUri, TEST_DB_NAME);
        client = new MongoClient(baseUri);
        await client.connect();
        collection = client.db(TEST_DB_NAME).collection('repo_test');
        repo = new DomainRepository<Item>(collection, ItemSchema, 'repo_test');
    });

    afterAll(async () => {
        await client.db(TEST_DB_NAME).dropCollection('repo_test').catch(() => {});
        await client.close();
    });

    beforeEach(async () => {
        await collection.deleteMany({});
    });

    // ─── create ──────────────────────────────────────────────────────────────

    describe('create()', () => {
        it('should persist a document and return it with id, createdAt, updatedAt', async () => {
            const result = await repo.create({ name: 'Item A', value: 10 } as Omit<Item, 'id' | 'createdAt' | 'updatedAt'>);
            expect(result.id).toBeDefined();
            expect(result.name).toBe('Item A');
            expect(result.value).toBe(10);
            expect(result.createdAt).toBeInstanceOf(Date);
            expect(result.updatedAt).toBeInstanceOf(Date);
        });

        it('should generate a valid ObjectId for the document', async () => {
            const result = await repo.create({ name: 'Item B', value: 20 } as Omit<Item, 'id' | 'createdAt' | 'updatedAt'>);
            expect(ObjectId.isValid(result.id)).toBe(true);
        });
    });

    // ─── find ────────────────────────────────────────────────────────────────

    describe('find()', () => {
        beforeEach(async () => {
            for (let i = 0; i < 10; i++) {
                await repo.create({ name: `Item ${i}`, value: i, category: i % 2 === 0 ? 'even' : 'odd' } as Omit<Item, 'id' | 'createdAt' | 'updatedAt'>);
            }
        });

        it('should return all documents when no options given', async () => {
            const results = await repo.find();
            expect(results).toHaveLength(10);
        });

        it('should filter by query', async () => {
            const results = await repo.find({ query: { category: 'even' } });
            expect(results).toHaveLength(5);
            results.forEach(item => expect(item.category).toBe('even'));
        });

        it('should apply limit', async () => {
            const results = await repo.find({ limit: 3 });
            expect(results).toHaveLength(3);
        });

        it('should apply offset (skip)', async () => {
            const all = await repo.find({ sort: { value: 1 } });
            const skipped = await repo.find({ sort: { value: 1 }, offset: 5 });
            expect(skipped).toHaveLength(5);
            expect(skipped[0].value).toBe(all[5].value);
        });

        it('should apply sort ascending', async () => {
            const results = await repo.find({ sort: { value: 1 } });
            for (let i = 1; i < results.length; i++) {
                expect(results[i].value).toBeGreaterThanOrEqual(results[i - 1].value);
            }
        });

        it('should apply sort descending', async () => {
            const results = await repo.find({ sort: { value: -1 } });
            for (let i = 1; i < results.length; i++) {
                expect(results[i].value).toBeLessThanOrEqual(results[i - 1].value);
            }
        });
    });

    // ─── paging over a sort that ties ────────────────────────────────────────

    describe('find() pages', () => {
        // Many rows share each sort value: MongoDB orders ties as it likes, differently per query, so
        // without a unique tiebreaker pages overlap -- rows repeat and others never come back
        // (serve.expose.find sorted by role: 70 of 276 missing, 2026-10-04).
        beforeEach(async () => {
            const rows = Array.from({ length: 300 }, (_, i) => ({ name: `Row ${i}`, value: i, category: ['a', 'b', 'c'][i % 3] }));
            await collection.insertMany(rows.map((r) => ({ ...r, createdAt: new Date(), updatedAt: new Date() })));
        });

        it('every row comes back exactly once when paging a sort on a field many rows share', async () => {
            const seen: string[] = [];

            for (let offset = 0; offset < 300; offset += 25) {
                const page = await repo.find({ sort: 'category', limit: 25, offset });
                seen.push(...page.map((r) => r.id));
            }

            expect(seen).toHaveLength(300);
            expect(new Set(seen).size).toBe(300);
        });

        it('every row comes back exactly once when paging with no sort at all', async () => {
            const seen: string[] = [];

            for (let offset = 0; offset < 300; offset += 40) {
                const page = await repo.find({ limit: 40, offset });
                seen.push(...page.map((r) => r.id));
            }

            expect(new Set(seen).size).toBe(300);
        });
    });

    // ─── the tie-break and the index ─────────────────────────────────────────

    describe('the sort sent to MongoDB (11-06)', () => {
        // intel's "nearest range below this address" -- sort { startIp: -1 }, one row -- ran as
        // { startIp: -1, _id: 1 }: an order no single-field index gives, so MongoDB read and sorted
        // ~283,000 rows in memory (~40 s) per lookup, and a burst took the platform's database down.
        let watched: MongoClient;
        let watchedRepo: DomainRepository<Item>;
        const sorts: Document[] = [];

        beforeAll(async () => {
            watched = new MongoClient(withTestDatabase(process.env.MONGODB_URI || 'mongodb://localhost:27017', TEST_DB_NAME), { monitorCommands: true });
            watched.on('commandStarted', (event) => {
                // The driver hands a command's sort over as a Map.
                const sort: unknown = event.command['sort'];
                if (event.commandName !== 'find') return;
                if (sort instanceof Map) sorts.push(Object.fromEntries(sort));
                else if (typeof sort === 'object' && sort !== null) sorts.push({ ...sort });
            });
            await watched.connect();
            watchedRepo = new DomainRepository<Item>(watched.db(TEST_DB_NAME).collection('repo_test'), ItemSchema, 'repo_test');
        });

        afterAll(async () => {
            await watched.close();
        });

        beforeEach(async () => {
            sorts.length = 0;
            await collection.createIndex({ value: 1 });
            const rows = Array.from({ length: 2_000 }, (_, i) => ({ name: `Row ${i}`, value: i, createdAt: new Date(), updatedAt: new Date() }));
            await collection.insertMany(rows);
        });

        /** Whether the plan MongoDB chose for this sort sorts in memory (the rejected ones aside). */
        const sortsInMemory = async (sort: Document): Promise<boolean> => {
            const plan = await collection.find({ value: { $lte: 1_500 } }).sort(sort).limit(1).explain('executionStats');
            const planner: unknown = plan['queryPlanner'];
            const winning: unknown = typeof planner === 'object' && planner !== null ? Reflect.get(planner, 'winningPlan') : undefined;
            return JSON.stringify(winning).includes('"stage":"SORT"');
        };

        it('one row (findOne) is sorted only as asked: no tie-break, so the index answers it', async () => {
            const found = await watchedRepo.findOne({ value: { $lte: 1_500 } }, { sort: '-value' });

            expect(found?.value).toBe(1_500);
            expect(sorts).toEqual([{ value: -1 }]);
            expect(await sortsInMemory({ value: -1 })).toBe(false);
            // What it used to send: the index cannot give it.
            expect(await sortsInMemory({ value: -1, _id: 1 })).toBe(true);
        });

        it('one row by find (limit 1, no offset) the same', async () => {
            await watchedRepo.find({ sort: '-value', limit: 1 });

            expect(sorts).toEqual([{ value: -1 }]);
        });

        it('a page keeps its tie-break, in the direction of the last key asked', async () => {
            await watchedRepo.find({ sort: '-value', limit: 25 });
            await watchedRepo.find({ sort: 'value', limit: 25, offset: 25 });
            await watchedRepo.findOne({}, { sort: '-value', offset: 3 });

            expect(sorts).toEqual([{ value: -1, _id: -1 }, { value: 1, _id: 1 }, { value: -1, _id: -1 }]);
        });

        it('an index ending in _id serves the page\'s sort, read either way', async () => {
            await collection.createIndex({ value: 1, _id: 1 });

            expect(await sortsInMemory({ value: -1, _id: -1 })).toBe(false);
            expect(await sortsInMemory({ value: 1, _id: 1 })).toBe(false);
        });
    });

    // ─── findOne ─────────────────────────────────────────────────────────────

    describe('findOne()', () => {
        beforeEach(async () => {
            for (let i = 0; i < 10; i++) {
                await repo.create({ name: `FindOne Item ${i}`, value: i } as Omit<Item, 'id' | 'createdAt' | 'updatedAt'>);
            }
        });

        it('should return the first matching document', async () => {
            const result = await repo.findOne({ name: 'FindOne Item 3' });
            expect(result).toBeDefined();
            expect(result!.name).toBe('FindOne Item 3');
            expect(result!.value).toBe(3);
        });

        it('should return undefined when no document matches', async () => {
            const result = await repo.findOne({ name: 'nonexistent' });
            expect(result).toBeUndefined();
        });

        it('should apply offset to skip documents (BUG FIX VALIDATION)', async () => {
            const first = await repo.findOne({}, { sort: { value: 1 }, offset: 0 });
            const sixth = await repo.findOne({}, { sort: { value: 1 }, offset: 5 });
            expect(first).toBeDefined();
            expect(sixth).toBeDefined();
            expect(first!.value).toBe(0);
            expect(sixth!.value).toBe(5);
            expect(first!.id).not.toBe(sixth!.id);
        });

        it('should return different documents for different offsets', async () => {
            const ids = new Set<string>();
            for (let i = 0; i < 10; i++) {
                const result = await repo.findOne({}, { sort: { value: 1 }, offset: i });
                expect(result).toBeDefined();
                expect(result!.value).toBe(i);
                ids.add(result!.id);
            }
            // All 10 offsets should produce 10 unique documents
            expect(ids.size).toBe(10);
        });

        it('should return undefined when offset exceeds total documents', async () => {
            const result = await repo.findOne({}, { offset: 100 });
            expect(result).toBeUndefined();
        });

        it('should apply sort', async () => {
            const asc = await repo.findOne({}, { sort: { value: 1 } });
            const desc = await repo.findOne({}, { sort: { value: -1 } });
            expect(asc!.value).toBe(0);
            expect(desc!.value).toBe(9);
        });
    });

    // ─── get ─────────────────────────────────────────────────────────────────

    describe('get()', () => {
        it('should retrieve a document by its ID', async () => {
            const created = await repo.create({ name: 'Get Me', value: 42 } as Omit<Item, 'id' | 'createdAt' | 'updatedAt'>);
            const fetched = await repo.get(created.id);
            expect(fetched).toBeDefined();
            expect(fetched!.id).toBe(created.id);
            expect(fetched!.name).toBe('Get Me');
        });

        it('should return undefined for an invalid ObjectId', async () => {
            const result = await repo.get('not-a-valid-id');
            expect(result).toBeUndefined();
        });

        it('should return undefined for a non-existent valid ObjectId', async () => {
            const result = await repo.get(new ObjectId().toString());
            expect(result).toBeUndefined();
        });
    });

    // ─── count ───────────────────────────────────────────────────────────────

    describe('count()', () => {
        it('should return 0 for empty collection', async () => {
            const count = await repo.count();
            expect(count).toBe(0);
        });

        it('should return the correct count after inserts', async () => {
            for (let i = 0; i < 5; i++) {
                await repo.create({ name: `Count ${i}`, value: i } as Omit<Item, 'id' | 'createdAt' | 'updatedAt'>);
            }
            const count = await repo.count();
            expect(count).toBe(5);
        });

        it('should count with query filter', async () => {
            for (let i = 0; i < 5; i++) {
                await repo.create({ name: `Count ${i}`, value: i, category: i < 3 ? 'A' : 'B' } as Omit<Item, 'id' | 'createdAt' | 'updatedAt'>);
            }
            const countA = await repo.count({ category: 'A' });
            expect(countA).toBe(3);
        });
    });

    // ─── update ──────────────────────────────────────────────────────────────

    describe('update()', () => {
        it('should update specific fields and return the updated document', async () => {
            const created = await repo.create({ name: 'Original', value: 1 } as Omit<Item, 'id' | 'createdAt' | 'updatedAt'>);
            const updated = await repo.update(created.id, { name: 'Updated' } as Partial<Item>);
            expect(updated).toBeDefined();
            expect(updated!.name).toBe('Updated');
            expect(updated!.value).toBe(1); // unchanged
        });

        it('should update the updatedAt timestamp', async () => {
            const created = await repo.create({ name: 'Timestamped', value: 1 } as Omit<Item, 'id' | 'createdAt' | 'updatedAt'>);
            // Small delay to ensure timestamp difference
            await new Promise(r => setTimeout(r, 50));
            const updated = await repo.update(created.id, { value: 999 } as Partial<Item>);
            expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
        });

        it('should return undefined for non-existent ID', async () => {
            const result = await repo.update(new ObjectId().toString(), { name: 'Nope' } as Partial<Item>);
            expect(result).toBeUndefined();
        });

        // 11-01: $set alone could never take a field away; a finished run kept its waitingFor.
        it('removes the fields it is told to unset, and only those; a field both set and unset is removed', async () => {
            const created = await repo.create({ name: 'Unset', value: 1, category: 'kept-until-unset' });

            const untouched = await repo.update(created.id, { value: 2 });
            expect(untouched?.category).toBe('kept-until-unset');

            const removed = await repo.update(created.id, { name: 'Renamed', category: 'ignored' }, undefined, ['category']);
            expect(removed?.name).toBe('Renamed');
            expect(removed?.value).toBe(2);
            expect(removed !== undefined && 'category' in removed).toBe(false);

            const raw = await collection.findOne({ _id: new ObjectId(created.id) });
            expect(raw !== null && 'category' in raw).toBe(false);
        });
    });

    // ─── delete ──────────────────────────────────────────────────────────────

    describe('delete()', () => {
        it('should delete a document and return true', async () => {
            const created = await repo.create({ name: 'Delete Me', value: 0 } as Omit<Item, 'id' | 'createdAt' | 'updatedAt'>);
            const deleted = await repo.delete(created.id);
            expect(deleted).toBe(true);

            const fetched = await repo.get(created.id);
            expect(fetched).toBeUndefined();
        });

        it('should return false for non-existent ID', async () => {
            const deleted = await repo.delete(new ObjectId().toString());
            expect(deleted).toBe(false);
        });

        it('should return false for invalid ObjectId', async () => {
            const deleted = await repo.delete('invalid');
            expect(deleted).toBe(false);
        });
    });

    // ─── mapQuery (id → _id conversion) ─────────────────────────────────────

    describe('query mapping', () => {
        it('should filter by id field (mapped to _id)', async () => {
            const created = await repo.create({ name: 'Mapped', value: 77 } as Omit<Item, 'id' | 'createdAt' | 'updatedAt'>);
            const results = await repo.find({ query: { id: created.id } });
            expect(results).toHaveLength(1);
            expect(results[0].name).toBe('Mapped');
        });

        it('should handle $in operator on id field', async () => {
            const a = await repo.create({ name: 'A', value: 1 } as Omit<Item, 'id' | 'createdAt' | 'updatedAt'>);
            const b = await repo.create({ name: 'B', value: 2 } as Omit<Item, 'id' | 'createdAt' | 'updatedAt'>);
            await repo.create({ name: 'C', value: 3 } as Omit<Item, 'id' | 'createdAt' | 'updatedAt'>);

            const results = await repo.find({ query: { id: { $in: [a.id, b.id] } } as Record<string, unknown> });
            expect(results).toHaveLength(2);
        });

        it('should handle $or queries', async () => {
            await repo.create({ name: 'OrA', value: 1 } as Omit<Item, 'id' | 'createdAt' | 'updatedAt'>);
            await repo.create({ name: 'OrB', value: 2 } as Omit<Item, 'id' | 'createdAt' | 'updatedAt'>);
            await repo.create({ name: 'OrC', value: 3 } as Omit<Item, 'id' | 'createdAt' | 'updatedAt'>);

            const results = await repo.find({
                query: { $or: [{ name: 'OrA' }, { name: 'OrC' }] } as Record<string, unknown>
            });
            expect(results).toHaveLength(2);
        });
    });

    // ─── replace ─────────────────────────────────────────────────────────────

    describe('replace()', () => {
        it('should replace the entire document except id and timestamps', async () => {
            const created = await repo.create({ name: 'Before', value: 1, category: 'old' } as Omit<Item, 'id' | 'createdAt' | 'updatedAt'>);
            const replaced = await repo.replace(created.id, { name: 'After', value: 999 } as Omit<Item, 'id' | 'createdAt' | 'updatedAt'>);
            expect(replaced).toBeDefined();
            expect(replaced!.name).toBe('After');
            expect(replaced!.value).toBe(999);
        });

        it('should return undefined for non-existent ID', async () => {
            const result = await repo.replace(new ObjectId().toString(), { name: 'Nope', value: 0 } as Omit<Item, 'id' | 'createdAt' | 'updatedAt'>);
            expect(result).toBeUndefined();
        });
    });

});
