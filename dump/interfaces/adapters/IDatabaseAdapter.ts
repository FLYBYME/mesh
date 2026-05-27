export interface DatabaseResult {
    lastInsertId?: number | string;
    changes: number;
}

export type FilterOperator = '=' | '!=' | '>' | '<' | '>=' | '<=';

export interface QueryFilter {
    column: string;
    operator: FilterOperator;
    value: unknown;
}

export interface QueryAST {
    table: string;
    select?: string[];
    filters: QueryFilter[];
    limit?: number;
    offset?: number;
    tenantId?: string;
}

/**
 * IDatabaseAdapter — Abstract interface for persistence layers.
 * Driven strictly through the agnostic QueryAST.
 */
export interface IDatabaseAdapter {
    name: string;
    init?(): Promise<void>;

    find<T = unknown>(ast: QueryAST): Promise<T[]>;
    count(ast: QueryAST): Promise<number>;
    insert<T = unknown>(table: string, data: T): Promise<DatabaseResult>;
    update<T = unknown>(ast: QueryAST, data: Partial<T>): Promise<DatabaseResult>;
    delete(ast: QueryAST): Promise<DatabaseResult>;

    transaction?<T>(fn: () => Promise<T>): Promise<T>;
}
