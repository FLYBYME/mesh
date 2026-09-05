import { z } from 'zod';
import { MongoClient } from 'mongodb';
import { defineCrud } from '../../interfaces/ICrudContract.js';
import { Database } from '../../db/Database.js';
import { DomainRepository } from '../../db/DomainRepository.js';
import { MeshError } from '../../core/MeshError.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { createTestApp, destroyTestApp, dropTestCollection, TEST_DB_NAME } from '../helpers/setup.js';
import { withTestDatabase } from '../../testing/TestHelpers.js';
import { ServiceModule } from '../../core/ServiceModule.js';
import { IServiceBroker } from '../../interfaces/IServiceBroker.js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true } as { path: string; quiet: boolean });

// ─── Domain Schemas & CRUD definitions ───────────────────────────────────────

const ArtifactSchema = z.object({
    digest: z.string(),
    size: z.number(),
});

export const artifactCrud = defineCrud('artifact', ArtifactSchema, {
    unique: ['digest'],
    dependencies: [],
});

const PartVersionSchema = z.object({
    partName: z.string(),
    version: z.string(),
    tarball: z.string().optional(),
});

export const partVersionCrud = defineCrud('partVersion', PartVersionSchema, {
    unique: [['partName', 'version']],
    dependencies: [],
});

const ReversePartVersionSchema = z.object({
    partName: z.string(),
    version: z.string(),
});

export const reversePartVersionCrud = defineCrud('reversePartVersion', ReversePartVersionSchema, {
    unique: [['version', 'partName']],
    dependencies: [],
});

const MultiTenantSiteSchema = z.object({
    host: z.string(),
    slug: z.string(),
    tenantId: z.string(),
    name: z.string().optional(),
});

export const multiTenantSiteCrud = defineCrud('multiTenantSite', MultiTenantSiteSchema, {
    scopedBy: 'tenantId',
    unique: [
        { fields: 'host', scope: 'global' },
        { fields: 'slug', scope: 'scoped' },
    ],
    dependencies: [],
});

class ArtifactModule extends ServiceModule {
    public readonly domain = 'artifact';
    constructor() {
        super();
        this.mountCrud(artifactCrud);
    }
}

class PartVersionModule extends ServiceModule {
    public readonly domain = 'partVersion';
    constructor() {
        super();
        this.mountCrud(partVersionCrud);
    }
}

class MultiTenantSiteModule extends ServiceModule {
    public readonly domain = 'multiTenantSite';
    constructor() {
        super();
        this.mountCrud(multiTenantSiteCrud);
    }
}

describe('Unique Key Constraints', () => {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    const baseUri = withTestDatabase(mongoUri, TEST_DB_NAME);
    let rawClient: MongoClient;

    beforeAll(async () => {
        rawClient = new MongoClient(baseUri);
        await rawClient.connect();
    });

    afterAll(async () => {
        await rawClient.close();
    });

    // ─── 1. Index Creation Timing & Idempotency ──────────────────────────────

    describe('1. Index creation timing & idempotency', () => {
        it('ensures indexes on DatabaseModule.onStart', async () => {
            const app = await createTestApp('uniq-node-boot');
            const db = app.getProvider<Database>('db');
            expect(db).toBeDefined();

            // Check that index exists in MongoDB for artifact
            const coll = rawClient.db(TEST_DB_NAME).collection('artifact');
            const indexes = await coll.indexes();
            const digestIndex = indexes.find(i => i.key && i.key['digest'] === 1);
            expect(digestIndex).toBeDefined();
            expect(digestIndex?.unique).toBe(true);

            await destroyTestApp(app);
        });

        it('ensures indexes lazily on first repo() call if not already ensured', async () => {
            const logger = new Logger(LogLevel.WARN);
            const db = new Database(logger, baseUri, TEST_DB_NAME);
            await db.connect();

            // Drop collection to start fresh
            await rawClient.db(TEST_DB_NAME).dropCollection('artifactlazy').catch(() => {});

            const LazySchema = z.object({ code: z.string() });
            const lazyCrud = defineCrud('artifactlazy', LazySchema, {
                unique: ['code'],
                dependencies: []
            });

            const repo = db.repo(lazyCrud.outputSchema, 'artifactlazy');
            expect(repo).toBeDefined();

            // Create a document which awaits readyPromise
            await repo.create({ code: 'code-1' });

            const coll = rawClient.db(TEST_DB_NAME).collection('artifactlazy');
            const indexes = await coll.indexes();
            const codeIndex = indexes.find(i => i.key && i.key['code'] === 1);
            expect(codeIndex).toBeDefined();
            expect(codeIndex?.unique).toBe(true);

            await db.disconnect();
        });

        it('does not re-run createIndex on second call (memoized / idempotent)', async () => {
            const logger = new Logger(LogLevel.WARN);
            const db = new Database(logger, baseUri, TEST_DB_NAME);
            await db.connect();

            const coll = db.getCollection('artifact');
            const createIndexSpy = jest.spyOn(coll, 'createIndex');

            // First call
            await db.ensureDomainIndexes('artifact');
            const initialCalls = createIndexSpy.mock.calls.length;

            // Second call - should return the cached promise with 0 additional calls
            await db.ensureDomainIndexes('artifact');
            expect(createIndexSpy.mock.calls.length).toBe(initialCalls);

            // Third call via repo() - should also not call createIndex again
            const repo = db.repo(artifactCrud.outputSchema, 'artifact');
            await repo.create({ digest: 'digest-idempotent-test', size: 100 });
            expect(createIndexSpy.mock.calls.length).toBe(initialCalls);

            createIndexSpy.mockRestore();
            await db.disconnect();
        });
    });

    // ─── 2. Legible MeshError on Duplicates ──────────────────────────────────

    describe('2. A duplicate must fail legibly (naming collection, field, value)', () => {
        let db: Database;
        let artifactRepo: DomainRepository<z.infer<typeof artifactCrud.outputSchema>>;
        let partVersionRepo: DomainRepository<z.infer<typeof partVersionCrud.outputSchema>>;

        beforeAll(async () => {
            const logger = new Logger(LogLevel.WARN);
            db = new Database(logger, baseUri, TEST_DB_NAME);
            await db.connect();
            artifactRepo = db.repo(artifactCrud.outputSchema, 'artifact');
            partVersionRepo = db.repo(partVersionCrud.outputSchema, 'partVersion');
        });

        afterAll(async () => {
            await db.disconnect();
        });

        beforeEach(async () => {
            await dropTestCollection('artifact');
            await dropTestCollection('partVersion');
        });

        it('fails create with duplicate single field as a legible MeshError', async () => {
            await artifactRepo.create({ digest: 'sha256:abc12345', size: 1024 });

            let error: MeshError | undefined;
            try {
                await artifactRepo.create({ digest: 'sha256:abc12345', size: 2048 });
            } catch (err) {
                if (err instanceof MeshError) error = err;
            }

            expect(error).toBeDefined();
            expect(error?.status).toBe(409);
            expect(error?.code).toBe('CONFLICT');
            // Message must name collection, field, and value
            expect(error?.message).toContain('artifact');
            expect(error?.message).toContain('digest');
            expect(error?.message).toContain('sha256:abc12345');
        });

        it('fails create with duplicate compound key as a legible MeshError', async () => {
            await partVersionRepo.create({ partName: 'mesh-core', version: '1.0.0', tarball: 'core-1.0.0.tgz' });

            let error: MeshError | undefined;
            try {
                await partVersionRepo.create({ partName: 'mesh-core', version: '1.0.0', tarball: 'core-1.0.0-alt.tgz' });
            } catch (err) {
                if (err instanceof MeshError) error = err;
            }

            expect(error).toBeDefined();
            expect(error?.status).toBe(409);
            expect(error?.code).toBe('CONFLICT');
            // Message must name collection, compound fields, and values
            expect(error?.message).toContain('partVersion');
            expect(error?.message).toContain('partName');
            expect(error?.message).toContain('version');
            expect(error?.message).toContain('mesh-core');
            expect(error?.message).toContain('1.0.0');
        });

        it('fails update with duplicate field as a legible MeshError', async () => {
            const doc1 = await artifactRepo.create({ digest: 'sha256:first', size: 100 });
            await artifactRepo.create({ digest: 'sha256:second', size: 200 });

            let error: MeshError | undefined;
            try {
                await artifactRepo.update(doc1.id, { digest: 'sha256:second' });
            } catch (err) {
                if (err instanceof MeshError) error = err;
            }

            expect(error).toBeDefined();
            expect(error?.status).toBe(409);
            expect(error?.code).toBe('CONFLICT');
            expect(error?.message).toContain('artifact');
            expect(error?.message).toContain('digest');
            expect(error?.message).toContain('sha256:second');
        });

        it('fails replace with duplicate field as a legible MeshError', async () => {
            const doc1 = await artifactRepo.create({ digest: 'sha256:rep1', size: 100 });
            await artifactRepo.create({ digest: 'sha256:rep2', size: 200 });

            let error: MeshError | undefined;
            try {
                await artifactRepo.replace(doc1.id, { digest: 'sha256:rep2', size: 150 });
            } catch (err) {
                if (err instanceof MeshError) error = err;
            }

            expect(error).toBeDefined();
            expect(error?.status).toBe(409);
            expect(error?.code).toBe('CONFLICT');
            expect(error?.message).toContain('artifact');
            expect(error?.message).toContain('digest');
        });

        it('fails findOneAndUpdate with duplicate field as a legible MeshError', async () => {
            const doc1 = await artifactRepo.create({ digest: 'sha256:foau1', size: 100 });
            await artifactRepo.create({ digest: 'sha256:foau2', size: 200 });

            let error: MeshError | undefined;
            try {
                await artifactRepo.findOneAndUpdate({ digest: 'sha256:foau1' }, { digest: 'sha256:foau2' });
            } catch (err) {
                if (err instanceof MeshError) error = err;
            }

            expect(error).toBeDefined();
            expect(error?.status).toBe(409);
            expect(error?.code).toBe('CONFLICT');
            expect(error?.message).toContain('artifact');
        });
    });

    // ─── 3. Existing Data with Duplicates ────────────────────────────────────

    describe('3. Existing data with duplicates refuses to start', () => {
        it('throws INDEX_CREATION_FAILED when collection already holds duplicates', async () => {
            const logger = new Logger(LogLevel.WARN);
            const db = new Database(logger, baseUri, TEST_DB_NAME);
            await db.connect();

            // Directly insert duplicate records into raw collection before building index
            const coll = db.getCollection('dirtyartifact');
            await coll.drop().catch(() => {});
            await coll.insertOne({ digest: 'sha256:duplicate', size: 100 });
            await coll.insertOne({ digest: 'sha256:duplicate', size: 200 });

            const DirtySchema = z.object({ digest: z.string(), size: z.number() });
            defineCrud('dirtyartifact', DirtySchema, {
                unique: ['digest'],
                dependencies: []
            });

            let error: MeshError | undefined;
            try {
                await db.ensureIndexes('dirtyartifact');
            } catch (err) {
                if (err instanceof MeshError) error = err;
            }

            expect(error).toBeDefined();
            expect(error?.code).toBe('INDEX_CREATION_FAILED');
            expect(error?.status).toBe(500);
            expect(error?.message).toContain('dirtyartifact');
            expect(error?.message).toContain('digest');
            expect(error?.message).toContain('existing data contains duplicates');

            await coll.drop().catch(() => {});
            await db.disconnect();
        });
    });

    // ─── 4. Compound Keys are Ordered ────────────────────────────────────────

    describe('4. Compound keys preserve field order in MongoDB index', () => {
        it('creates index with (partName, version) ordering when specified', async () => {
            const logger = new Logger(LogLevel.WARN);
            const db = new Database(logger, baseUri, TEST_DB_NAME);
            await db.connect();

            await db.ensureDomainIndexes('partVersion');
            const coll = rawClient.db(TEST_DB_NAME).collection('partVersion');
            const indexes = await coll.indexes();
            const index = indexes.find(i => i.name === 'uniq_partVersion_partName_version');
            expect(index).toBeDefined();
            expect(Object.keys(index!.key)).toEqual(['partName', 'version']);

            await db.disconnect();
        });

        it('creates index with (version, partName) ordering when specified', async () => {
            const logger = new Logger(LogLevel.WARN);
            const db = new Database(logger, baseUri, TEST_DB_NAME);
            await db.connect();

            await db.ensureDomainIndexes('reversePartVersion');
            const coll = rawClient.db(TEST_DB_NAME).collection('reversePartVersion');
            const indexes = await coll.indexes();
            const index = indexes.find(i => i.name === 'uniq_reversePartVersion_version_partName');
            expect(index).toBeDefined();
            expect(Object.keys(index!.key)).toEqual(['version', 'partName']);

            await db.disconnect();
        });
    });

    // ─── 5. ScopedBy Interaction ─────────────────────────────────────────────

    describe('5. scopedBy interaction (scoped uniqueness vs global uniqueness)', () => {
        let app: MeshApp;
        let broker: IServiceBroker;

        const tenantAMeta = { meta: { user: { id: 'u1', tenant_id: 'tenant-a' } } };
        const tenantBMeta = { meta: { user: { id: 'u2', tenant_id: 'tenant-b' } } };

        beforeAll(async () => {
            await dropTestCollection('multiTenantSite');
            app = await createTestApp('uniq-scoped-node');
            broker = app.getProvider<IServiceBroker>('broker');
            await app.registerModule(new MultiTenantSiteModule());
        });

        afterAll(async () => {
            await destroyTestApp(app);
        });

        beforeEach(async () => {
            await dropTestCollection('multiTenantSite');
        });

        it('allows different tenants to have the same slug (scoped uniqueness)', async () => {
            const siteA = await broker.call(
                'multiTenantSite.create',
                { host: 'site-a.example.com', slug: 'main' },
                tenantAMeta
            );
            expect(siteA).toBeDefined();

            const siteB = await broker.call(
                'multiTenantSite.create',
                { host: 'site-b.example.com', slug: 'main' },
                tenantBMeta
            );
            expect(siteB).toBeDefined();
        });

        it('refuses duplicate slug within the SAME tenant (scoped uniqueness)', async () => {
            await broker.call(
                'multiTenantSite.create',
                { host: 'site-1.example.com', slug: 'main' },
                tenantAMeta
            );

            let error: MeshError | undefined;
            try {
                await broker.call(
                    'multiTenantSite.create',
                    { host: 'site-2.example.com', slug: 'main' },
                    tenantAMeta
                );
            } catch (err) {
                if (err instanceof MeshError) error = err;
            }

            expect(error).toBeDefined();
            expect(error?.status).toBe(409);
            expect(error?.code).toBe('CONFLICT');
            expect(error?.message).toContain('multiTenantSite');
            expect(error?.message).toContain('slug');
        });

        it('refuses duplicate hostname across DIFFERENT tenants (global uniqueness)', async () => {
            await broker.call(
                'multiTenantSite.create',
                { host: 'shared-origin.com', slug: 'site-a' },
                tenantAMeta
            );

            let error: MeshError | undefined;
            try {
                await broker.call(
                    'multiTenantSite.create',
                    { host: 'shared-origin.com', slug: 'site-b' },
                    tenantBMeta
                );
            } catch (err) {
                if (err instanceof MeshError) error = err;
            }

            expect(error).toBeDefined();
            expect(error?.status).toBe(409);
            expect(error?.code).toBe('CONFLICT');
            expect(error?.message).toContain('multiTenantSite');
            expect(error?.message).toContain('host');
            expect(error?.message).toContain('shared-origin.com');
        });
    });

    // ─── 6. End-to-End Broker Calls ──────────────────────────────────────────

    describe('6. End-to-end broker CRUD operations with unique constraints', () => {
        let app: MeshApp;
        let broker: IServiceBroker;

        beforeAll(async () => {
            await dropTestCollection('artifact');
            await dropTestCollection('partVersion');
            app = await createTestApp('uniq-e2e-node');
            broker = app.getProvider<IServiceBroker>('broker');
            await app.registerModule(new ArtifactModule());
            await app.registerModule(new PartVersionModule());
        });

        afterAll(async () => {
            await destroyTestApp(app);
        });

        beforeEach(async () => {
            await dropTestCollection('artifact');
            await dropTestCollection('partVersion');
        });

        it('enforces artifact digest uniqueness on broker artifact.create', async () => {
            await broker.call('artifact.create', { digest: 'sha256:e2e-1', size: 100 });

            let error: MeshError | undefined;
            try {
                await broker.call('artifact.create', { digest: 'sha256:e2e-1', size: 200 });
            } catch (err) {
                if (err instanceof MeshError) error = err;
            }

            expect(error).toBeDefined();
            expect(error?.status).toBe(409);
            expect(error?.code).toBe('CONFLICT');
            expect(error?.message).toContain('artifact');
            expect(error?.message).toContain('digest');
        });

        it('enforces partVersion compound uniqueness on broker partVersion.create', async () => {
            await broker.call('partVersion.create', { partName: 'pkg-x', version: '2.0.0' });

            let error: MeshError | undefined;
            try {
                await broker.call('partVersion.create', { partName: 'pkg-x', version: '2.0.0' });
            } catch (err) {
                if (err instanceof MeshError) error = err;
            }

            expect(error).toBeDefined();
            expect(error?.status).toBe(409);
            expect(error?.code).toBe('CONFLICT');
            expect(error?.message).toContain('partVersion');
            expect(error?.message).toContain('pkg-x');
            expect(error?.message).toContain('2.0.0');
        });

        it('enforces uniqueness on create_many through broker', async () => {
            await broker.call('artifact.create', { digest: 'sha256:existing', size: 50 });

            let error: MeshError | undefined;
            try {
                await broker.call('artifact.create_many', [
                    { digest: 'sha256:new1', size: 10 },
                    { digest: 'sha256:existing', size: 20 },
                ]);
            } catch (err) {
                if (err instanceof MeshError) error = err;
            }

            expect(error).toBeDefined();
            expect(error?.status).toBe(409);
            expect(error?.code).toBe('CONFLICT');
            expect(error?.message).toContain('artifact');
            expect(error?.message).toContain('sha256:existing');
        });
    });
});
