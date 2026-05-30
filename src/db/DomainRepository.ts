import { Collection, ObjectId, Document, Filter, OptionalId, WithId } from 'mongodb';
import { z } from 'zod';
import { FindOptions, ListResult, StrictFilterQuery } from './types.js';

/**
 * DomainRepository: The strictly-typed gateway to a MongoDB collection.
 * 
 * Mandate: No 'any', no double assertions. 100% Zod validated.
 */
export class DomainRepository<T extends { id: string }> {
    constructor(
        private collection: Collection<Document>,
        private schema: z.ZodType<T>,
        private domain: string
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
        options: { sort?: Partial<Record<keyof T, 1 | -1>>; offset?: number } = {}
    ): Promise<T | undefined> {
        const mapped = this.mapQuery(query);
        const cursor = this.collection.find(mapped as Filter<Document>);
        if (options.offset) cursor.skip(options.offset);
        if (options.sort) {
            cursor.sort(options.sort as Record<string, 1 | -1>);
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
        data: Omit<T, 'id' | 'createdAt' | 'updatedAt'> & Partial<T>
    ): Promise<T> {
        const inputId = (data as Record<string, unknown>).id;
        const tempId = typeof inputId === 'string' && ObjectId.isValid(inputId) ? inputId : new ObjectId().toString();

        const parsed = this.schema.parse({
            ...data,
            id: tempId,
            createdAt: new Date(),
            updatedAt: new Date()
        });

        const { id, createdAt, updatedAt, ...rest } = parsed as Record<string, unknown>;
        const docToInsert = {
            ...rest,
            createdAt,
            updatedAt
        } as OptionalId<Document>;

        docToInsert._id = new ObjectId(id as string);

        await this.collection.insertOne(docToInsert);
        return this.mapOutbound(docToInsert as WithId<Document>);
    }

    public async update(
        id: string,
        data: Partial<T>
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
        return this.mapOutbound(result as WithId<Document>);
    }

    public async replace(
        id: string,
        data: Omit<T, 'id' | 'createdAt' | 'updatedAt'> & Partial<T>
    ): Promise<T | undefined> {
        if (!ObjectId.isValid(id)) return undefined;

        const existing = await this.collection.findOne({ _id: new ObjectId(id) } as Filter<Document>);
        if (!existing) return undefined;

        const parsed = this.schema.parse({
            ...data,
            id,
            createdAt: existing.createdAt || new Date(),
            updatedAt: new Date()
        });

        const { id: _id, createdAt, updatedAt, ...rest } = parsed as Record<string, unknown>;
        const updateDoc = {
            ...rest,
            createdAt,
            updatedAt: new Date()
        } as Record<string, unknown>;

        const result = await this.collection.findOneAndReplace(
            { _id: new ObjectId(id) } as Filter<Document>,
            updateDoc as Document,
            { returnDocument: 'after' }
        );

        if (!result) return undefined;
        return this.mapOutbound(result as WithId<Document>);
    }

    public async delete(id: string): Promise<boolean> {
        if (!ObjectId.isValid(id)) return false;

        const result = await this.collection.deleteOne({ _id: new ObjectId(id) } as Filter<Document>);
        return (result.deletedCount || 0) > 0;
    }
    
    public async resolve(params: { [idField: string]: string | string[] }): Promise<T | T[]> {
        // Find the id parameter
        const idVal = Object.values(params).find(v => typeof v === 'string' || Array.isArray(v)) as string | string[];
        
        if (Array.isArray(idVal)) {
            const objectIds = idVal.filter(id => ObjectId.isValid(id)).map(id => new ObjectId(id));
            if (objectIds.length === 0) return [];
            
            const docs = await this.collection.find({ _id: { $in: objectIds } } as Filter<Document>).toArray();
            return docs.map(doc => this.mapOutbound(doc));
        } else {
            const doc = await this.get(idVal as string);
            if (!doc) throw new Error(`Document not found: ${idVal}`);
            return doc;
        }
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

    private isRecord(obj: unknown): obj is Record<string, unknown> {
        return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
    }
}
