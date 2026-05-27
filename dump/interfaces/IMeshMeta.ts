/**
 * IMeshMeta — Centralized schema for common metadata across the mesh.
 * This interface is meant to be augmented by domain services.
 */
export interface IMeshMeta {
    /**
     * Authenticated user info.
     */
    user?: {
        id: string;
        tenant_id: string;
        roles?: string[];
        [key: string]: unknown;
    };

    /**
     * Direct tenant association if user is not present.
     */
    tenant_id?: string;

    /**
     * Distributed Tracing Metadata.
     */
    traceId?: string;
    spanId?: string;
    parentId?: string;

    /**
     * Transaction context for database consistency.
     */
    _tx?: boolean;

    /**
     * Generic catch-all for local and plugin-specific state.
     */
    [key: string]: unknown;
}
