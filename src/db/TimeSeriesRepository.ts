import { Collection, Document, Filter, AnyBulkWriteOperation } from 'mongodb';
import { z } from 'zod';

/**
 * TimeSeriesRepository: Specialized repository for MongoDB Time Series collections.
 */
export class TimeSeriesRepository<T extends { timestamp: Date; tags: Record<string, string> }> {
    constructor(
        private collection: Collection<Document>,
        private schema: z.ZodType<T>,
        private domain: string,
        private readyPromise?: Promise<void>
    ) { }

    /**
     * insert: Batch inserts multiple points.
     */
    public async insert(points: Partial<T>[]): Promise<{ count: number }> {
        if (this.readyPromise) {
            await this.readyPromise;
        }
        const now = new Date();
        const docs = points.map(p => {
            const point = {
                ...p,
                timestamp: p.timestamp || now,
                tags: p.tags || {}
            };
            return this.schema.parse(point);
        });

        if (docs.length === 0) return { count: 0 };

        const result = await this.collection.insertMany(docs as unknown as Document[]);
        return { count: result.insertedCount };
    }

    /**
     * query: Retrieves points by time range and tags.
     */
    public async query(params: { from?: Date; to?: Date; tags?: Record<string, string>; limit?: number }): Promise<T[]> {
        if (this.readyPromise) {
            await this.readyPromise;
        }
        const filter: Filter<Document> = {};

        if (params.from || params.to) {
            filter.timestamp = {};
            if (params.from) filter.timestamp.$gte = params.from;
            if (params.to) filter.timestamp.$lte = params.to;
        }

        if (params.tags) {
            for (const [key, value] of Object.entries(params.tags)) {
                filter[`tags.${key}`] = value;
            }
        }

        const cursor = this.collection.find(filter).sort({ timestamp: 1 });
        if (params.limit) cursor.limit(params.limit);

        const docs = await cursor.toArray();
        return docs.map(doc => this.mapOutbound(doc));
    }

    /**
     * latest: Returns the most recent point matching the tags.
     */
    public async latest(tags?: Record<string, string>): Promise<T | undefined> {
        if (this.readyPromise) {
            await this.readyPromise;
        }
        const filter: Filter<Document> = {};
        if (tags) {
            for (const [key, value] of Object.entries(tags)) {
                filter[`tags.${key}`] = value;
            }
        }

        const doc = await this.collection.findOne(filter, { sort: { timestamp: -1 } });
        return doc ? this.mapOutbound(doc) : undefined;
    }

    /**
     * aggregate: Computes statistics over time intervals.
     */
    public async aggregate(params: { 
        from?: Date; 
        to?: Date; 
        tags?: Record<string, string>; 
        interval: string; 
        aggregates: Record<string, 'min' | 'max' | 'avg' | 'sum' | 'count'> 
    }): Promise<Record<string, unknown>[]> {
        if (this.readyPromise) {
            await this.readyPromise;
        }
        const pipeline: Document[] = [];

        // 1. Match
        const match: Filter<Document> = {};
        if (params.from || params.to) {
            match.timestamp = {};
            if (params.from) match.timestamp.$gte = params.from;
            if (params.to) match.timestamp.$lte = params.to;
        }
        if (params.tags) {
            for (const [key, value] of Object.entries(params.tags)) {
                match[`tags.${key}`] = value;
            }
        }
        pipeline.push({ $match: match });

        // 2. Group by interval
        const group: Document = {
            _id: {
                $dateTrunc: {
                    date: "$timestamp",
                    unit: this.parseInterval(params.interval)
                }
            }
        };

        for (const [field, func] of Object.entries(params.aggregates)) {
            const mongoFunc = func === 'count' ? '$sum' : `$${func}`;
            group[field] = { [mongoFunc]: func === 'count' ? 1 : `$${field}` };
        }

        pipeline.push({ $group: group });

        // 3. Sort by time
        pipeline.push({ $sort: { "_id": 1 } });

        // 4. Project
        pipeline.push({
            $project: {
                _id: 0,
                timestamp: "$_id",
                ...Object.fromEntries(Object.keys(params.aggregates).map(k => [k, 1]))
            }
        });

        const results = await this.collection.aggregate(pipeline).toArray();
        return results as unknown as Record<string, unknown>[];
    }

    private parseInterval(interval: string): 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year' {
        if (interval.endsWith('s')) return 'second';
        if (interval.endsWith('m')) return 'minute';
        if (interval.endsWith('h')) return 'hour';
        if (interval.endsWith('d')) return 'day';
        if (interval.endsWith('w')) return 'week';
        if (interval.endsWith('M')) return 'month';
        if (interval.endsWith('y')) return 'year';
        return 'hour'; // fallback
    }

    private mapOutbound(doc: Document): T {
        const { _id, ...rest } = doc;
        return this.schema.parse(rest);
    }
}
