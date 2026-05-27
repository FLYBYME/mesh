import { z } from 'zod';

/**
 * MongoOperators: Restricts MongoDB operators to the strict type of the field they are querying.
 */
export interface MongoOperators<T> {
    $eq?: T;
    $ne?: T;
    $in?: T[];
    $nin?: T[];
    $gt?: T;
    $gte?: T;
    $lt?: T;
    $lte?: T;
    $exists?: boolean;
    $regex?: T extends string ? string : never;
}

/**
 * StrictFilterQuery: The single source of truth for query shapes. 
 */
export type StrictFilterQuery<T> = {
    [K in keyof T]?: T[K] | MongoOperators<T[K]>;
} & {
    $or?: StrictFilterQuery<T>[];
    $and?: StrictFilterQuery<T>[];
};

/**
 * FindOptions: Standardized options for simple array queries.
 */
export interface FindOptions<T> {
    query?: StrictFilterQuery<T>;
    limit?: number;
    offset?: number;
    sort?: Partial<Record<keyof T, 1 | -1>>;
}

/**
 * ListResult: The structured output for paginated queries.
 */
export interface ListResult<T> {
    rows: T[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

// Ensure Zod is referenced for module identification but suppress unused var lint
export const _ZodReference = z.string().optional();
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
_ZodReference;
