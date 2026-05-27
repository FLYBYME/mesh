import { Collection, ObjectId, Document, Filter, OptionalId, WithId } from 'mongodb';
import { z } from 'zod';
import { FindOptions, ListResult, StrictFilterQuery } from './types';
import { IEventBus } from '../../events/events';

/**
 * DomainRepository: The strictly-typed gateway to a MongoDB collection.
 * 
 * Mandate: No 'any', no double assertions. 100% Zod validated.
 */
export class DomainRepository<T extends { id: string }> {
    constructor(
        private collection: Collection<Document>,
        private schema: z.ZodType<T>,
        private domain: string,
        private events: IEventBus
    ) { }

    /**
     * find: Returns an array of documents matching the query.
     */
    public async find(options: FindOptions<T> = {}): Promise<T[]> {
        const query = this.mapQuery(options.query || {});
        const cursor = this.collection.find(query as Filter<Document>);

        if (options.offset) cursor.skip(options.offset);
        if (options.limit) cursor.limit(options.limit);
        if (options.sort) cursor.sort(options.sort as Record<string, 1 | -1>);

        const docs = await cursor.toArray();
        return docs.map(doc => this.mapOutbound(doc));
    }

    /**
     * list: Returns a paginated ListResult.
     */
    public async list(options: { page?: number, pageSize?: number, query?: StrictFilterQuery<T>, sort?: Partial<Record<keyof T, 1 | -1>> } = {}): Promise<ListResult<T>> {
        const query = this.mapQuery(options.query || {});

        const page = Math.max(1, options.page || 1);
        const pageSize = Math.max(1, options.pageSize || 50);
        const skip = (page - 1) * pageSize;

        const [total, docs] = await Promise.all([
            this.collection.countDocuments(query as Filter<Document>),
            this.collection.find(query as Filter<Document>)
                .skip(skip)
                .limit(pageSize)
                .sort(options.sort as Record<string, 1 | -1> || { createdAt: -1 })
                .toArray()
        ]);

        const rows = docs.map(doc => this.mapOutbound(doc));
        const totalPages = Math.ceil(total / pageSize);

        return { rows, total, page, pageSize, totalPages };
    }

    /**
     * findOne: Returns a single document matching the query.
     */
    public async findOne(
        query: StrictFilterQuery<T>,
        options: { sort?: Record<string, 1 | -1> } = {}
    ): Promise<T | undefined> {
        const mapped = this.mapQuery(query);
        const cursor = this.collection.find(mapped as Filter<Document>);
        if (options.sort) {
            cursor.sort(options.sort);
        }
        cursor.limit(1);
        const docs = await cursor.toArray();
        return docs[0] ? this.mapOutbound(docs[0]) : undefined;
    }

    /**
     * count: Returns the number of documents matching the query.
     */
    public async count(query: StrictFilterQuery<T> = {}): Promise<number> {
        const mapped = this.mapQuery(query);
        return await this.collection.countDocuments(mapped as Filter<Document>);
    }

    /**
     * get: Retrieves a single document by its ID.
     */
    public async get(id: string): Promise<T | undefined> {
        if (!ObjectId.isValid(id)) return undefined;
        const doc = await this.collection.findOne({ _id: new ObjectId(id) } as Filter<Document>);
        return doc ? this.mapOutbound(doc) : undefined;
    }

    public async create(
        data: Omit<T, 'id' | 'createdAt' | 'updatedAt'> & Partial<T>,
        correlationId: string
    ): Promise<T> {
        const { id, ...rest } = data as Record<string, unknown>;
        const docToInsert = {
            ...rest,
            createdAt: new Date(),
            updatedAt: new Date()
        } as OptionalId<Document>;

        if (typeof id === 'string' && ObjectId.isValid(id)) {
            docToInsert._id = new ObjectId(id);
        }

        const result = await this.collection.insertOne(docToInsert);
        const doc = await this.collection.findOne({ _id: result.insertedId } as Filter<Document>);
        if (!doc) throw new Error(`Persistence Error: Failed to retrieve created document in ${this.domain}`);

        const item = this.mapOutbound(doc);

        await this.events.dispatch('data:created', correlationId, {
            domain: this.domain,
            id: item.id,
            item: this.toRecord(item)
        });

        return item;
    }

    public async update(
        id: string,
        data: Partial<T>,
        correlationId: string
    ): Promise<T | undefined> {
        if (!ObjectId.isValid(id)) return undefined;

        const updateData = {
            ...data,
            updatedAt: new Date()
        };
        const updateDoc = { ...updateData } as Record<string, unknown>;
        delete updateDoc['id'];

        const result = await this.collection.findOneAndUpdate(
            { _id: new ObjectId(id) } as Filter<Document>,
            { $set: updateDoc },
            { returnDocument: 'after' }
        );

        if (!result) return undefined;
        const item = this.mapOutbound(result as WithId<Document>);

        await this.events.dispatch('data:updated', correlationId, {
            domain: this.domain,
            id: item.id,
            patch: this.toRecord(data),
            item: this.toRecord(item)
        });

        return item;
    }

    public async delete(id: string, correlationId: string): Promise<boolean> {
        if (!ObjectId.isValid(id)) return false;

        const result = await this.collection.deleteOne({ _id: new ObjectId(id) } as Filter<Document>);
        const success = (result.deletedCount || 0) > 0;

        if (success) {
            await this.events.dispatch('data:deleted', correlationId, {
                domain: this.domain,
                id
            });
        }

        return success;
    }

    private mapOutbound(doc: Document): T {
        const { _id, ...rest } = doc;
        const mapped = {
            id: (_id as ObjectId).toString(),
            ...rest
        };

        return this.schema.parse(mapped);
    }

    private mapQuery(query: StrictFilterQuery<T>): Filter<Document> {
        const mapped = { ...query } as Record<string, unknown>;

        if (mapped['id']) {
            const idVal = mapped['id'];
            if (typeof idVal === 'string') {
                mapped['_id'] = ObjectId.isValid(idVal) ? new ObjectId(idVal) : new ObjectId('000000000000000000000000');
            } else if (this.isRecord(idVal)) {
                const ops = idVal as Record<string, unknown>;
                if (Array.isArray(ops['$in'])) {
                    ops['$in'] = (ops['$in'] as string[]).map(id => ObjectId.isValid(id) ? new ObjectId(id) : new ObjectId('000000000000000000000000'));
                }
                if (Array.isArray(ops['$nin'])) {
                    ops['$nin'] = (ops['$nin'] as string[]).map(id => ObjectId.isValid(id) ? new ObjectId(id) : new ObjectId('000000000000000000000000'));
                }
                if (typeof ops['$eq'] === 'string') {
                    ops['$eq'] = ObjectId.isValid(ops['$eq']) ? new ObjectId(ops['$eq']) : new ObjectId('000000000000000000000000');
                }
                if (typeof ops['$ne'] === 'string') {
                    ops['$ne'] = ObjectId.isValid(ops['$ne']) ? new ObjectId(ops['$ne']) : new ObjectId('000000000000000000000000');
                }
                mapped['_id'] = ops;
            }
            delete mapped['id'];
        }

        if (Array.isArray(mapped['$or'])) mapped['$or'] = (mapped['$or'] as StrictFilterQuery<T>[]).map(q => this.mapQuery(q));
        if (Array.isArray(mapped['$and'])) mapped['$and'] = (mapped['$and'] as StrictFilterQuery<T>[]).map(q => this.mapQuery(q));

        return mapped as Filter<Document>;
    }

    private toRecord(obj: unknown): Record<string, unknown> {
        if (typeof obj === 'object' && obj !== null) {
            return obj as Record<string, unknown>;
        }
        return {};
    }

    private isRecord(obj: unknown): obj is Record<string, unknown> {
        return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
    }
}
