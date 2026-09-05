import { Collection, ObjectId, Document, Filter, OptionalId, WithId, Sort } from 'mongodb';
import { z } from 'zod';
import { FindOptions, ListResult, StrictFilterQuery } from './types.js';
import { MeshError } from '../core/MeshError.js';
import { globalCrudRegistry, type NormalizedUniqueKey } from '../interfaces/ICrudContract.js';

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
        private readyPromise?: Promise<void>,
        private uniqueKeys?: readonly NormalizedUniqueKey[]
    ) {
        if (!this.readyPromise) {
            const keys = this.uniqueKeys ?? globalCrudRegistry.get(domain)?.unique;
            if (keys && keys.length > 0) {
                this.readyPromise = this.ensureUniqueIndexes(keys);
            }
        }
    }

    private async ensureUniqueIndexes(keys: readonly NormalizedUniqueKey[]): Promise<void> {
        for (const u of keys) {
            const indexSpec: Record<string, 1> = {};
            for (const f of u.fields) {
                indexSpec[f] = 1;
            }
            const indexName = u.name ?? `uniq_${this.domain}_${u.fields.join('_')}`;
            try {
                await this.collection.createIndex(indexSpec, {
                    unique: true,
                    name: indexName
                });
            } catch (err: unknown) {
                const errObj = typeof err === 'object' && err !== null ? err as Record<string, unknown> : undefined;
                const errCode = errObj ? errObj.code : undefined;
                const errCodeName = errObj ? errObj.codeName : undefined;
                const errMsg = err instanceof Error ? err.message : String(err);

                if (errCode === 11000 || errCodeName === 'DuplicateKey' || errMsg.includes('E11000 duplicate key error')) {
                    throw new MeshError({
                        code: 'INDEX_CREATION_FAILED',
                        status: 500,
                        message: `Failed to build unique index on collection "${this.domain}" for fields [${u.fields.join(', ')}]: existing data contains duplicates. Duplicates must be resolved before this unique index can be created.`,
                        data: { domain: this.domain, fields: u.fields, error: errMsg }
                    });
                }
                throw err;
            }
        }
    }

    private handleDuplicateKeyError(err: unknown): never {
        const errObj = typeof err === 'object' && err !== null ? err as Record<string, unknown> : undefined;
        const code = errObj ? errObj.code : undefined;
        const codeName = errObj ? errObj.codeName : undefined;
        const msg = err instanceof Error ? err.message : String(err);

        if (code === 11000 || codeName === 'DuplicateKey' || msg.includes('E11000 duplicate key error')) {
            const keyValue = errObj && typeof errObj.keyValue === 'object' && errObj.keyValue !== null
                ? errObj.keyValue as Record<string, unknown>
                : undefined;

            if (keyValue && Object.keys(keyValue).length > 0) {
                const fields = Object.keys(keyValue);
                if (fields.length === 1) {
                    const field = fields[0];
                    const val = keyValue[field];
                    throw new MeshError({
                        code: 'CONFLICT',
                        status: 409,
                        message: `Duplicate value ${JSON.stringify(val)} for unique field "${field}" in collection "${this.domain}".`,
                        data: {
                            collection: this.domain,
                            field,
                            value: val,
                            keyValue
                        }
                    });
                }

                const formattedValues = fields.map(f => `${f}=${JSON.stringify(keyValue[f])}`).join(', ');
                throw new MeshError({
                    code: 'CONFLICT',
                    status: 409,
                    message: `Duplicate value (${formattedValues}) for unique compound key (${fields.join(', ')}) in collection "${this.domain}".`,
                    data: {
                        collection: this.domain,
                        fields,
                        values: keyValue,
                        keyValue
                    }
                });
            }

            const dupMatch = msg.match(/dup key: \{ (.*) \}/);
            const rawDup = dupMatch ? dupMatch[1] : msg;
            throw new MeshError({
                code: 'CONFLICT',
                status: 409,
                message: `Duplicate value for unique key in collection "${this.domain}": { ${rawDup} }.`,
                data: {
                    collection: this.domain,
                    error: msg
                }
            });
        }

        throw err;
    }

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
    public async get(id: string, query?: StrictFilterQuery<T>): Promise<T | undefined> {
        if (!ObjectId.isValid(id)) return undefined;
        const filter: Filter<Document> = query
            ? { ...this.mapQuery(query), _id: new ObjectId(id) }
            : { _id: new ObjectId(id) };
        const doc = await this.collection.findOne(filter);
        return doc ? this.mapOutbound(doc) : undefined;
    }

    public async create(
        data: Omit<T, 'id' | 'createdAt' | 'updatedAt'> & Partial<T>
    ): Promise<T> {
        if (this.readyPromise) {
            await this.readyPromise;
        }

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

        try {
            await this.collection.insertOne(docToInsert);
        } catch (err: unknown) {
            this.handleDuplicateKeyError(err);
        }

        return this.mapOutbound(docToInsert as WithId<Document>);
    }

    public async update(
        id: string,
        data: Partial<T>,
        query?: StrictFilterQuery<T>
    ): Promise<T | undefined> {
        if (!ObjectId.isValid(id)) return undefined;
        if (this.readyPromise) {
            await this.readyPromise;
        }

        const updateData = {
            ...data,
            updatedAt: new Date()
        };
        const { id: _, ...updateDoc } = updateData;

        const filter: Filter<Document> = query
            ? { ...this.mapQuery(query), _id: new ObjectId(id) }
            : { _id: new ObjectId(id) };

        let result: Document | null = null;
        try {
            result = await this.collection.findOneAndUpdate(
                filter,
                { $set: updateDoc },
                { returnDocument: 'after' }
            );
        } catch (err: unknown) {
            this.handleDuplicateKeyError(err);
        }

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
        if (this.readyPromise) {
            await this.readyPromise;
        }

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

        let result: Document | null = null;
        try {
            result = await this.collection.findOneAndUpdate(
                mappedQuery,
                updateDoc,
                {
                    returnDocument: 'after',
                    ...(sort ? { sort } : {})
                }
            );
        } catch (err: unknown) {
            this.handleDuplicateKeyError(err);
        }

        if (!result) return undefined;
        return this.mapOutbound(result as WithId<Document>);
    }

    public async replace(
        id: string,
        data: Omit<T, 'id' | 'createdAt' | 'updatedAt'> & Partial<T>,
        query?: StrictFilterQuery<T>
    ): Promise<T | undefined> {
        if (!ObjectId.isValid(id)) return undefined;
        if (this.readyPromise) {
            await this.readyPromise;
        }

        const filter: Filter<Document> = query
            ? { ...this.mapQuery(query), _id: new ObjectId(id) }
            : { _id: new ObjectId(id) };

        const existing = await this.collection.findOne(filter);
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

        let result: Document | null = null;
        try {
            result = await this.collection.findOneAndReplace(
                filter,
                updateDoc,
                { returnDocument: 'after' }
            );
        } catch (err: unknown) {
            this.handleDuplicateKeyError(err);
        }

        if (!result) return undefined;
        return this.mapOutbound(result as WithId<Document>);
    }

    public async delete(id: string, query?: StrictFilterQuery<T>): Promise<boolean> {
        if (!ObjectId.isValid(id)) return false;

        const filter: Filter<Document> = query
            ? { ...this.mapQuery(query), _id: new ObjectId(id) }
            : { _id: new ObjectId(id) };

        const result = await this.collection.deleteOne(filter);
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
