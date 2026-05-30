import { z } from 'zod';
import { defineContract, ToolContract, defaultPrint } from './IToolContract.js';

// --- Type Helpers ---
type Prettify<T> = { [K in keyof T]: T[K] } & { [K in keyof T as never]: T[K] };

/**
 * TimeSeriesParamsSchema: Standard parameters for time-series queries.
 */
export const TimeSeriesParamsSchema = z.object({
    from: z.coerce.date().optional().describe("Start timestamp (inclusive)."),
    to: z.coerce.date().optional().describe("End timestamp (inclusive)."),
    tags: z.record(z.string(), z.string()).optional().describe("Filter by metadata tags."),
    limit: z.number().optional().describe("Max count of points to return."),
});

/**
 * TimeSeriesAggregateParamsSchema: Standard parameters for time-series aggregation.
 */
export const TimeSeriesAggregateParamsSchema = TimeSeriesParamsSchema.extend({
    interval: z.string().describe("Aggregation interval (e.g., '1m', '1h', '1d')."),
    aggregates: z.record(z.string(), z.enum(['min', 'max', 'avg', 'sum', 'count'])).describe("Fields and their aggregation functions."),
});

/**
 * AnyTimeSeriesContracts: Generic base for any Time Series contract set.
 */
export interface AnyTimeSeriesContracts extends Record<string, unknown> {
    readonly domain: string;
    readonly insert: ToolContract<z.ZodTypeAny, z.ZodTypeAny, never>;
    readonly query: ToolContract<z.ZodTypeAny, z.ZodTypeAny, never>;
    readonly aggregate: ToolContract<z.ZodTypeAny, z.ZodTypeAny, never>;
    readonly latest: ToolContract<z.ZodTypeAny, z.ZodTypeAny, never>;
}

export type TimeSeriesContracts<
    TBase extends z.ZodObject<z.ZodRawShape>,
    TOut extends z.ZodObject<
        z.ZodRawShape,
        z.UnknownKeysParam,
        z.ZodTypeAny,
        Prettify<z.output<TBase> & { timestamp: Date; tags: Record<string, string> }>,
        Prettify<z.input<TBase> & { timestamp: Date; tags: Record<string, string> }>
    > = z.ZodObject<
        TBase['shape'] & { timestamp: z.ZodDate; tags: z.ZodRecord<z.ZodString, z.ZodString> },
        z.UnknownKeysParam,
        z.ZodTypeAny,
        Prettify<z.output<TBase> & { timestamp: Date; tags: Record<string, string> }>,
        Prettify<z.input<TBase> & { timestamp: Date; tags: Record<string, string> }>
    >
> = {
    readonly domain: string;
    readonly baseSchema: TBase;
    readonly outputSchema: TOut;

    readonly insert: ToolContract<z.ZodArray<z.ZodObject<TBase['shape'] & { timestamp: z.ZodOptional<z.ZodDate>, tags: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>> }>>, z.ZodObject<{ count: z.ZodNumber }>>;
    readonly query: ToolContract<typeof TimeSeriesParamsSchema, z.ZodArray<TOut>>;
    readonly aggregate: ToolContract<typeof TimeSeriesAggregateParamsSchema, z.ZodArray<z.ZodRecord<z.ZodString, z.ZodTypeAny>>>;
    readonly latest: ToolContract<z.ZodObject<{ tags: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>> }>, z.ZodOptional<TOut>>;
};

/**
 * defineTimeSeries: Factory for creating Time Series tool sets.
 */
export function defineTimeSeries<
    TShape extends z.ZodRawShape,
    TBase extends z.ZodObject<TShape>,
    TOut extends z.ZodObject<
        z.ZodRawShape,
        z.UnknownKeysParam,
        z.ZodTypeAny,
        Prettify<z.output<TBase> & { timestamp: Date; tags: Record<string, string> }>,
        Prettify<z.input<TBase> & { timestamp: Date; tags: Record<string, string> }>
    > = z.ZodObject<
        TShape & { timestamp: z.ZodDate; tags: z.ZodRecord<z.ZodString, z.ZodString> },
        z.UnknownKeysParam,
        z.ZodTypeAny,
        Prettify<z.output<TBase> & { timestamp: Date; tags: Record<string, string> }>,
        Prettify<z.input<TBase> & { timestamp: Date; tags: Record<string, string> }>
    >
>(
    domain: string,
    baseSchema: TBase,
    options: {
        timeout?: Partial<Record<'insert' | 'query' | 'aggregate' | 'latest', number>>
    } = {}
): TimeSeriesContracts<TBase, TOut> {
    const outputSchema = baseSchema.extend({
        timestamp: z.coerce.date(),
        tags: z.record(z.string(), z.string())
    }) as unknown as TOut;

    const inputPointSchema = baseSchema.extend({
        timestamp: z.coerce.date().optional(),
        tags: z.record(z.string(), z.string()).optional()
    }) as z.ZodObject<TBase['shape'] & { timestamp: z.ZodOptional<z.ZodDate>, tags: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>> }>;

    const insertContract = defineContract({
        domain, action: 'insert',
        description: `Insert time-series points into ${domain}.`,
        inputSchema: z.array(inputPointSchema),
        outputSchema: z.object({ count: z.number() }),
        rest: { method: 'POST', path: `/${domain}/insert` },
        isTimeSeries: true,
        destructive: true,
        timeout: options.timeout?.insert,
        print: (out) => `Inserted ${out.count} points.`
    });

    const queryContract = defineContract({
        domain, action: 'query',
        description: `Query time-series points from ${domain}.`,
        inputSchema: TimeSeriesParamsSchema,
        outputSchema: z.array(outputSchema),
        rest: { method: 'GET', path: `/${domain}/query` },
        isTimeSeries: true,
        timeout: options.timeout?.query,
        print: defaultPrint
    });

    const aggregateContract = defineContract({
        domain, action: 'aggregate',
        description: `Aggregate time-series data from ${domain}.`,
        inputSchema: TimeSeriesAggregateParamsSchema,
        outputSchema: z.array(z.record(z.string(), z.unknown())),
        rest: { method: 'GET', path: `/${domain}/aggregate` },
        isTimeSeries: true,
        timeout: options.timeout?.aggregate,
        print: defaultPrint
    });

    const latestContract = defineContract({
        domain, action: 'latest',
        description: `Get the latest point from ${domain}.`,
        inputSchema: z.object({ tags: z.record(z.string(), z.string()).optional() }),
        outputSchema: outputSchema.optional(),
        rest: { method: 'GET', path: `/${domain}/latest` },
        isTimeSeries: true,
        timeout: options.timeout?.latest,
        print: defaultPrint
    });

    return {
        domain,
        baseSchema,
        outputSchema,
        insert: insertContract,
        query: queryContract,
        aggregate: aggregateContract,
        latest: latestContract
    };
}
