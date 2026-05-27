import { MongoClient, Db } from 'mongodb';
import { z } from 'zod';
import { DomainRepository } from './DomainRepository';
import { IEventBus } from '../../events/events';
//import URL from "node:url";


/**
 * Database: The dynamic repository manager for the Castellan Engine.
 */
export class Database {
    private client: MongoClient;
    private dbInstance: Db | null = null;
    private repositories: Map<string, DomainRepository<{ id: string }>> = new Map();

    constructor(
        private events: IEventBus,
        uri: string = process.env.MONGODB_URI || 'mongodb://localhost:27017',
        private dbName: string = 'ask-castellan'
    ) {
        const url = new URL(uri);
        this.dbName = url.pathname.substring(1) || dbName;
        this.client = new MongoClient(uri, { serverSelectionTimeoutMS: 2000 });
    }

    /**
     * connect: Establishes connection and ensures the DB is ready.
     */
    public async connect(): Promise<void> {
        await this.client.connect();
        this.dbInstance = this.client.db(this.dbName);
        console.log(`[DB] Connected to MongoDB: ${this.dbInstance.databaseName}`);
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
        const repository = new DomainRepository<T>(collection, schema, domain, this.events);

        this.repositories.set(domain, repository as unknown as DomainRepository<{ id: string }>);
        return repository;
    }

    public async disconnect(): Promise<void> {
        await this.client.close();
    }
}
