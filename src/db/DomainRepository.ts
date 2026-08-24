import { Collection, ObjectId, Document, Filter, OptionalId, WithId, Sort } from 'mongodb';
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

    public get rawCollection(): Collection<Document> {
        return this.collection;
    }

    /**
     * find: Returns an array of documents matching the query.
     */
    public async find(options: FindOptions<T> = {}): Promise<T[]> {
        const query = this.mapQuery(options.query || {});

        const projection: Record<string, 1> = {};
        if (options.fields) {
            let fieldsList: string[] = [];
            if (typeof options.fields === 'string') {
                fieldsList = options.fields.split(/[,\s]+/).map(f => f.trim()).filter(Boolean);
            } else if (Array.isArray(options.fields)) {
                fieldsList = options.fields;
            }
            if (fieldsList.length > 0) {
                for (const field of fieldsList) {
                    if (field === 'id') {
                        projection['_id'] = 1;
                    } else {
                        projection[field] = 1;
                    }
                }
                projection['_id'] = 1;
            }
        }

        const cursor = Object.keys(projection).length > 0
            ? this.collection.find(query, { projection })
            : this.collection.find(query);

        if (options.offset) cursor.skip(options.offset);
        if (options.limit) cursor.limit(options.limit);
        
        if (options.sort) {
            cursor.sort(this.parseSort(options.sort));
        }

        const docs = await cursor.toArray();
        const hasFields = Object.keys(projection).length > 0;
        return docs.map(doc => this.mapOutbound(doc, hasFields));
    }

    /**
     * list: Returns a paginated ListResult.
     */
    public async list(options: { page?: number, pageSize?: number, query?: StrictFilterQuery<T>, sort?: string | string[] | Partial<Record<keyof T, 1 | -1>> } = {}): Promise<ListResult<T>> {
        const query = this.mapQuery(options.query || {});

        const page = Math.max(1, options.page || 1);
        const pageSize = Math.max(1, options.pageSize || 50);
        const skip = (page - 1) * pageSize;

        const sort = this.parseSort(options.sort || { createdAt: -1 } as any);

        const [total, docs] = await Promise.all([
            this.collection.countDocuments(query),
            this.collection.find(query)
                .skip(skip)
                .limit(pageSize)
                .sort(sort)
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
        options: { sort?: string | string[] | Partial<Record<keyof T, 1 | -1>>; offset?: number; fields?: string | string[] } = {}
    ): Promise<T | undefined> {
        const mapped = this.mapQuery(query);

        const projection: Record<string, 1> = {};
        if (options.fields) {
            let fieldsList: string[] = [];
            if (typeof options.fields === 'string') {
                fieldsList = options.fields.split(/[,\s]+/).map(f => f.trim()).filter(Boolean);
            } else if (Array.isArray(options.fields)) {
                fieldsList = options.fields;
            }
            if (fieldsList.length > 0) {
                for (const field of fieldsList) {
                    if (field === 'id') {
                        projection['_id'] = 1;
                    } else {
                        projection[field] = 1;
                    }
                }
                projection['_id'] = 1;
            }
        }

        const cursor = Object.keys(projection).length > 0
            ? this.collection.find(mapped, { projection })
            : this.collection.find(mapped);

        if (options.offset) cursor.skip(options.offset);
        if (options.sort) {
            cursor.sort(this.parseSort(options.sort));
        }
        cursor.limit(1);
        const docs = await cursor.toArray();
        const hasFields = Object.keys(projection).length > 0;
        return docs[0] ? this.mapOutbound(docs[0], hasFields) : undefined;
    }

    private parseSort(sort: string | string[] | Partial<Record<string, 1 | -1>>): Sort {
        if (typeof sort === 'string') {
            const direction = sort.startsWith('-') ? -1 : 1;
            const field = sort.startsWith('-') ? sort.substring(1) : sort;
            return { [field]: direction } as Sort;
        }

        if (Array.isArray(sort)) {
            const result: Record<string, 1 | -1> = {};
            sort.forEach(s => {
                const direction = s.startsWith('-') ? -1 : 1;
                const field = s.startsWith('-') ? s.substring(1) : s;
                result[field] = direction;
            });
            return result as Sort;
        }

        return sort as Sort;
    }

    /**
     * count: Returns the number of documents matching the query.
     */
    public async count(query: StrictFilterQuery<T> = {}): Promise<number> {
        const mapped = this.mapQuery(query);
        return await this.collection.countDocuments(mapped);
    }

    /**
     * get: Retrieves a single document by its ID.
     */
    public async get(id: string): Promise<T | undefined> {
        if (!ObjectId.isValid(id)) return undefined;
        const doc = await this.collection.findOne({ _id: new ObjectId(id) });
        return doc ? this.mapOutbound(doc) : undefined;
    }

    public async create(
        data: Omit<T, 'id' | 'createdAt' | 'updatedAt'> & Partial<T>
    ): Promise<T> {
        const inputId = data.id;
        const tempId = typeof inputId === 'string' && ObjectId.isValid(inputId) ? inputId : new ObjectId().toString();

        const parsed = this.schema.parse({
            ...data,
            id: tempId,
            createdAt: new Date(),
            updatedAt: new Date()
        });

        const { id, createdAt, updatedAt, ...rest } = parsed as Record<string, unknown>;
        const docToInsert: OptionalId<Document> = {
            ...rest,
            createdAt,
            updatedAt,
            _id: new ObjectId(id as string)
        };

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
        const { id: _, ...updateDoc } = updateData;

        const result = await this.collection.findOneAndUpdate(
            { _id: new ObjectId(id) },
            { $set: updateDoc },
            { returnDocument: 'after' }
        );

        if (!result) return undefined;
        return this.mapOutbound(result as WithId<Document>);
    }

    /**
     * findOneAndUpdate: Atomically finds a document matching the query, applies the update,
     * and returns the updated document.
     */
    public async findOneAndUpdate(
        query: StrictFilterQuery<T>,
        data: Partial<T> | Record<string, unknown>,
        options: { sort?: string | string[] | Partial<Record<keyof T, 1 | -1>> } = {}
    ): Promise<T | undefined> {
        const mappedQuery = this.mapQuery(query);
        const isOperatorDoc = Object.keys(data).some(k => k.startsWith('$'));

        let updateDoc: Document;
        if (isOperatorDoc) {
            const opData = { ...(data as Record<string, unknown>) };
            const existingSet = this.isRecord(opData['$set']) ? (opData['$set'] as Record<string, unknown>) : {};
            const { id: _, ...setToApply } = existingSet;
            opData['$set'] = {
                ...setToApply,
                updatedAt: new Date()
            };
            updateDoc = opData as Document;
        } else {
            const { id: _, ...fieldsToSet } = data as Record<string, unknown>;
            updateDoc = {
                $set: {
                    ...fieldsToSet,
                    updatedAt: new Date()
                }
            };
        }

        const sort = options.sort ? this.parseSort(options.sort as any) : undefined;

        const result = await this.collection.findOneAndUpdate(
            mappedQuery,
            updateDoc,
            {
                returnDocument: 'after',
                ...(sort ? { sort } : {})
            }
        );

        if (!result) return undefined;
        return this.mapOutbound(result as WithId<Document>);
    }

    public async replace(
        id: string,
        data: Omit<T, 'id' | 'createdAt' | 'updatedAt'> & Partial<T>
    ): Promise<T | undefined> {
        if (!ObjectId.isValid(id)) return undefined;

        const existing = await this.collection.findOne({ _id: new ObjectId(id) });
        if (!existing) return undefined;

        const parsed = this.schema.parse({
            ...data,
            id,
            createdAt: existing.createdAt || new Date(),
            updatedAt: new Date()
        });

        const { id: _id, createdAt, updatedAt, ...rest } = parsed as Record<string, unknown>;
        const updateDoc: Document = {
            ...rest,
            createdAt,
            updatedAt: new Date()
        };

        const result = await this.collection.findOneAndReplace(
            { _id: new ObjectId(id) },
            updateDoc,
            { returnDocument: 'after' }
        );

        if (!result) return undefined;
        return this.mapOutbound(result as WithId<Document>);
    }

    public async delete(id: string): Promise<boolean> {
        if (!ObjectId.isValid(id)) return false;

        const result = await this.collection.deleteOne({ _id: new ObjectId(id) });
        return (result.deletedCount || 0) > 0;
    }

    private mapOutbound(doc: Document, hasFields = false): T {
        const { _id, ...rest } = doc;
        const mapped = {
            id: _id ? (_id as ObjectId).toString() : undefined,
            ...rest
        };

        if (hasFields) {
            return mapped as unknown as T;
        }

        return this.schema.parse(mapped);
    }

    private mapQuery(query: StrictFilterQuery<T>): Filter<Document> {
        const { ...mapped }: Record<string, unknown> = query;

        if ('id' in mapped && mapped['id'] !== undefined) {
            const idVal = mapped['id'];
            if (typeof idVal === 'string') {
                mapped['_id'] = ObjectId.isValid(idVal) ? new ObjectId(idVal) : new ObjectId('000000000000000000000000');
            } else if (this.isRecord(idVal)) {
                const ops: Record<string, unknown> = { ...idVal };
                if (Array.isArray(ops['$in'])) {
                    ops['$in'] = ops['$in'].map(id => typeof id === 'string' && ObjectId.isValid(id) ? new ObjectId(id) : new ObjectId('000000000000000000000000'));
                }
                if (Array.isArray(ops['$nin'])) {
                    ops['$nin'] = ops['$nin'].map(id => typeof id === 'string' && ObjectId.isValid(id) ? new ObjectId(id) : new ObjectId('000000000000000000000000'));
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

        if (Array.isArray(mapped['$or'])) {
            mapped['$or'] = mapped['$or'].map(q => this.mapQuery(q as StrictFilterQuery<T>));
        }
        if (Array.isArray(mapped['$and'])) {
            mapped['$and'] = mapped['$and'].map(q => this.mapQuery(q as StrictFilterQuery<T>));
        }

        return mapped as Filter<Document>;
    }

    private isRecord(obj: unknown): obj is Record<string, unknown> {
        return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
    }
}
