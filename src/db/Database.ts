import { MongoClient, Db, Collection, Document } from 'mongodb';
import { z } from 'zod';
import { DomainRepository } from './DomainRepository.js';
import { TimeSeriesRepository } from './TimeSeriesRepository.js';
import { ILogger } from '../interfaces/ILogger.js';
import { globalCrudRegistry, type NormalizedUniqueKey, type IServiceCollectionRegistry } from '../interfaces/ICrudContract.js';
import { MeshError } from '../core/MeshError.js';

/**
 * Database: The dynamic repository manager for the Mesh Engine.
 */
export class Database {
    private client: MongoClient;
    private dbInstance: Db | null = null;
    private repositories: Map<string, DomainRepository<{ id: string }>> = new Map();
    private tsRepositories: Map<string, TimeSeriesRepository<{ timestamp: Date, tags: Record<string, string> }>> = new Map();
    private ensuredIndexes: Map<string, Promise<void>> = new Map();

    constructor(
        private logger: ILogger,
        uri: string = process.env.MONGODB_URI || 'mongodb://localhost:27017',
        private dbName: string = 'mesh'
    ) {
        try {
            const url = new URL(uri);
            this.dbName = url.pathname.substring(1) || dbName;
        } catch (e) {
            // Keep default dbName if URL parsing fails
        }
        // Without this, the driver's own default BSON-encodes an `undefined` property as `null`
        // rather than omitting it -- every `.optional()` schema in this codebase means "absent",
        // never "null" (nothing here uses `.nullable()`), so a field left unset at create time gets
        // silently written as `null` and then fails its own schema on the very next read. Found
        // live: `serve.hold.create`/`update` writing an unset `reason` field, invisible until the
        // row was read back and re-parsed.
        this.client = new MongoClient(uri, { ignoreUndefined: true });
    }

    /**
     * connect: Establishes connection and ensures the DB is ready.
     */
    public async connect(): Promise<void> {
        await this.client.connect();
        this.dbInstance = this.client.db(this.dbName);
        this.logger.info(`[DB] Connected to MongoDB: ${this.dbInstance.databaseName}`);
    }

    public get db(): Db | null {
        return this.dbInstance;
    }

    public getDb(): Db | null {
        return this.dbInstance;
    }

    public getCollection(name: string): Collection<Document> {
        if (!this.dbInstance) throw new Error('Database not connected. Call connect() first.');
        return this.dbInstance.collection(name);
    }

    /**
     * ensureIndexes: Ensures unique indexes across all registered CRUD collections,
     * or for a specific domain if specified.
     *
     * Called during DatabaseModule.onStart to build indexes before traffic arrives.
     * Idempotent and memoized: subsequent calls for a domain reuse the existing Promise.
     */
    public async ensureIndexes(domain?: string): Promise<void> {
        if (!this.dbInstance) throw new Error('Database not connected. Call connect() first.');

        if (domain) {
            await this.ensureDomainIndexes(domain);
            return;
        }

        const promises: Promise<void>[] = [];
        for (const crud of globalCrudRegistry.values()) {
            if (crud.unique && crud.unique.length > 0) {
                promises.push(this.ensureDomainIndexes(crud.domain, crud.unique));
            }
        }
        await Promise.all(promises);
    }

    /**
     * ensureDomainIndexes: Creates unique indexes for a single domain's collection.
     *
     * Returns a cached promise if index creation for this domain has already started.
     * If the collection already contains duplicates, fails closed by throwing a descriptive
     * MeshError explaining that existing duplicates must be resolved before the unique
     * index can be created.
     */
    public ensureDomainIndexes(domain: string, uniqueKeys?: readonly NormalizedUniqueKey[]): Promise<void> {
        const existing = this.ensuredIndexes.get(domain);
        if (existing) {
            return existing;
        }

        const promise = (async () => {
            if (!this.dbInstance) throw new Error('Database not connected. Call connect() first.');
            const keys = uniqueKeys ?? globalCrudRegistry.get(domain)?.unique;
            if (!keys || keys.length === 0) return;

            const collection = this.dbInstance.collection(domain);
            for (const u of keys) {
                const indexSpec: Record<string, 1> = {};
                for (const f of u.fields) {
                    indexSpec[f] = 1;
                }
                const indexName = u.name ?? `uniq_${domain}_${u.fields.join('_')}`;
                try {
                    await collection.createIndex(indexSpec, {
                        unique: true,
                        name: indexName
                    });
                    this.logger.info(`[DB] Ensured unique index "${indexName}" on collection "${domain}"`);
                } catch (err: unknown) {
                    const errObj = typeof err === 'object' && err !== null ? err as Record<string, unknown> : undefined;
                    const errCode = errObj ? errObj.code : undefined;
                    const errCodeName = errObj ? errObj.codeName : undefined;
                    const errMsg = err instanceof Error ? err.message : String(err);

                    if (errCode === 11000 || errCodeName === 'DuplicateKey' || errMsg.includes('E11000 duplicate key error')) {
                        throw new MeshError({
                            code: 'INDEX_CREATION_FAILED',
                            status: 500,
                            message: `Failed to build unique index on collection "${domain}" for fields [${u.fields.join(', ')}]: existing data contains duplicates. Duplicates must be resolved before this unique index can be created.`,
                            data: { domain, fields: u.fields, error: errMsg }
                        });
                    }
                    throw err;
                }
            }
        })();

        this.ensuredIndexes.set(domain, promise);
        return promise;
    }

    /**
     * repo: Dynamically retrieves or creates a strictly-typed DomainRepository.
     *
     * **Unscoped, unstripped, no events, no hooks.** Every row of every tenant, hidden fields
     * included, no `data.*`/`<domain>.*` events fired, no module `beforeCrud`/`afterCrud` run. That
     * is deliberate and occasionally exactly right -- a cross-tenant admin sweep
     * (`catalog.service.ts`'s `watchRelease`), or a caller with a genuine need for a hidden field's
     * real value (`defineCrud`'s own `hidden` option describes this escape hatch) -- but it is not
     * the default a handler reaching into its own or another domain's data should reach for.
     * **Use `ctx.db(domain)` (`IServiceContext.ts`) unless you specifically need every tenant's rows
     * or a hidden field's real value.** `ctx.db()` is scoped, stripped, and hook-respecting by
     * construction (backed by `CrudExecutor`, the same executor `DatabaseMiddleware` itself calls);
     * this method is not, on purpose, for the narrow cases that need exactly that.
     */
    public repo<T extends { id: string }>(
        schema: z.ZodType<T>,
        domain: string,
        options?: { unique?: readonly NormalizedUniqueKey[] }
    ): DomainRepository<T> {
        if (!this.dbInstance) throw new Error('Database not connected. Call connect() first.');

        const cached = this.repositories.get(domain);
        if (cached) return cached as unknown as DomainRepository<T>;

        const collection = this.dbInstance.collection(domain);
        const uniqueKeys = options?.unique ?? globalCrudRegistry.get(domain)?.unique;
        const readyPromise = uniqueKeys && uniqueKeys.length > 0
            ? this.ensureDomainIndexes(domain, uniqueKeys)
            : this.ensuredIndexes.get(domain);

        const repository = new DomainRepository<T>(collection, schema, domain, readyPromise, uniqueKeys);

        this.repositories.set(domain, repository as unknown as DomainRepository<{ id: string }>);
        return repository;
    }

    /**
     * collection: `repo()` without the caller having to supply (and keep in sync with) the right
     * schema for the right domain by hand -- both are looked up from what `defineCrud` already
     * registered at import time (`globalCrudRegistry`). The return type comes from
     * `IServiceCollectionRegistry` (see `ICrudContract.ts`), generated the same way
     * `IServiceToolRegistry`/`EventRegistry` are: read off the real `defineCrud(...)` export's own
     * `outputSchema`, the literal same schema object this method validates every read and write
     * against at runtime (`crud.outputSchema` below) -- not a type merely assumed to match it. That
     * equivalence is what makes this sound without a guessing cast, the same bar `ctx.call()` holds:
     * one real schema, read from twice, never two schemas asserted to agree.
     *
     * Throws rather than returning a loosely-typed fallback: an unregistered domain here is a real
     * bug (either this collection never called `defineCrud`, or this call is racing module import
     * order), not a case worth guessing at.
     *
     * **Same unscoped/unstripped/no-events/no-hooks caveat as `repo()` above -- see there.** This
     * method only fixed `repo()`'s type-soundness problem (the right schema, automatically); it does
     * not fix the safety problem. Prefer `ctx.db(domain)` unless this collection's rare escape hatch
     * is genuinely what you need.
     */
    public collection<D extends keyof IServiceCollectionRegistry & string>(
        domain: D
    ): DomainRepository<IServiceCollectionRegistry[D] & { id: string }> {
        const crud = globalCrudRegistry.get(domain);
        if (crud === undefined) {
            throw new MeshError({
                code: 'NOT_FOUND',
                status: 500,
                message: `database.collection("${domain}"): no defineCrud registration found for this domain. ` +
                    `Either "${domain}" never called defineCrud, or this ran before its module was imported.`,
            });
        }
        type Row = IServiceCollectionRegistry[D] & { id: string };
        return this.repo(crud.outputSchema as z.ZodType<Row>, domain, { unique: crud.unique });
    }

    /**
     * tsRepo: Dynamically retrieves or creates a strictly-typed TimeSeriesRepository.
     */
    public tsRepo<T extends { timestamp: Date, tags: Record<string, string> }>(
        schema: z.ZodType<T>,
        domain: string
    ): TimeSeriesRepository<T> {
        if (!this.dbInstance) throw new Error('Database not connected. Call connect() first.');

        const cached = this.tsRepositories.get(domain);
        if (cached) return cached as unknown as TimeSeriesRepository<T>;

        const collection = this.dbInstance.collection(domain);
        
        const readyPromise = this.ensureTimeSeriesCollection(domain);

        const repository = new TimeSeriesRepository<T>(collection, schema, domain, readyPromise);
        this.tsRepositories.set(domain, repository as unknown as TimeSeriesRepository<{ timestamp: Date, tags: Record<string, string> }>);
        return repository;
    }

    private async ensureTimeSeriesCollection(name: string): Promise<void> {
        if (!this.dbInstance) return;
        try {
            const collections = await this.dbInstance.listCollections({ name }).toArray();
            if (collections.length === 0) {
                this.logger.info(`[DB] Creating Time Series collection: ${name}`);
                await this.dbInstance.createCollection(name, {
                    timeseries: {
                        timeField: 'timestamp',
                        metaField: 'tags',
                        granularity: 'seconds'
                    }
                });
            }
        } catch (err: any) {
            if (err?.codeName !== 'NamespaceExists' && err?.code !== 48) {
                this.logger.error(`[DB] Failed to ensure TS collection ${name}: ${err.message}`);
            }
        }
    }

    public async disconnect(): Promise<void> {
        await this.client.close();
        this.repositories.clear();
        this.tsRepositories.clear();
        this.ensuredIndexes.clear();
        this.logger.info(`[DB] Disconnected from MongoDB`);
    }
}
