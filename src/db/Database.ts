import { MongoClient, Db, Collection, Document } from 'mongodb';
import { z } from 'zod';
import { DomainRepository } from './DomainRepository.js';
import { TimeSeriesRepository } from './TimeSeriesRepository.js';
import { ILogger } from '../interfaces/ILogger.js';

/**
 * Database: The dynamic repository manager for the Mesh Engine.
 */
export class Database {
    private client: MongoClient;
    private dbInstance: Db | null = null;
    private repositories: Map<string, DomainRepository<{ id: string }>> = new Map();
    private tsRepositories: Map<string, TimeSeriesRepository<{ timestamp: Date, tags: Record<string, string> }>> = new Map();

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
        this.client = new MongoClient(uri);
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
     * repo: Dynamically retrieves or creates a strictly-typed DomainRepository.
     */
    public repo<T extends { id: string }>(
        schema: z.ZodType<T>,
        domain: string
    ): DomainRepository<T> {
        if (!this.dbInstance) throw new Error('Database not connected. Call connect() first.');

        const cached = this.repositories.get(domain);
        if (cached) return cached as unknown as DomainRepository<T>;

        const collection = this.dbInstance.collection(domain);
        const repository = new DomainRepository<T>(collection, schema, domain);

        this.repositories.set(domain, repository as unknown as DomainRepository<{ id: string }>);
        return repository;
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
        this.logger.info(`[DB] Disconnected from MongoDB`);
    }
}
