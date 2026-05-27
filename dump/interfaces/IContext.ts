import type { IServiceActionRegistry, IServiceEventRegistry  } from './IGlobalRegistry';
import type { IMeshMeta  } from './IMeshMeta';

/**
 * ITraceMeta — Strict tracing metadata for distributed observability.
 */
export interface ITraceMeta {
    readonly traceId: string;
    readonly spanId: string;
    readonly parentId?: string;
    readonly sampled?: boolean;
}

/**
 * IContext — Core execution context for actions and events.
 * Static shape for V8 optimization.
 */
export interface IContext<TParams = Record<string, unknown>, TMeta = IMeshMeta> {
    readonly id: string;
    readonly actionName: string;
    readonly params: TParams;
    readonly meta: TMeta;
    readonly correlationID: string;
    readonly callerID: string | null;
    readonly nodeID: string;
    
    // Tracing properties
    readonly traceId?: string;
    readonly spanId?: string;
    readonly parentId?: string;
    
    // Pipeline control properties (pre-defined for stability)
    targetNodeID?: string;
    result?: unknown; 
    error?: Error | null;

    /** Calls a mesh action with strict inference from context. */
    call<K extends keyof IServiceActionRegistry>(
        action: K, 
        params: IServiceActionRegistry[K] extends { params: import('zod').ZodType<infer P> } ? P : never,
        options?: { nodeID?: string; timeout?: number }
    ): Promise<IServiceActionRegistry[K] extends { returns: import('zod').ZodType<infer R> } ? R : never>;

    /** Fallback untyped call. */
    call<TResult = unknown>(
        action: string, 
        params: Record<string, unknown>,
        options?: { nodeID?: string; timeout?: number }
    ): Promise<TResult>;

    /** Emits a mesh event with strict inference. */
    emit<K extends keyof IServiceEventRegistry>(
        event: K, 
        payload: IServiceEventRegistry[K] extends { payload: import('zod').ZodType<infer P> } ? P : never
    ): void;

    /** Fallback untyped emit. */
    emit(event: string, payload: Record<string, unknown>): void;
}
