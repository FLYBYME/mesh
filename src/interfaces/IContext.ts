import type { IMeshMeta } from './IMeshMeta.js';

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
 * IContext — Internal pipeline context for actions and events.
 *
 * This is a pure data envelope used by the ServiceBroker middleware pipeline.
 * It is NOT exposed to tool authors — tool functions receive IServiceContext instead.
 *
 * Static shape for V8 optimization.
 */
export interface IContext<TParams = Record<string, unknown>, TMeta = IMeshMeta> {
    readonly id: string;
    readonly toolName: string;
    readonly params: TParams;
    readonly meta: TMeta;
    readonly correlationID: string;
    readonly callerID: string | null;
    readonly nodeID: string;

    // Tracing properties
    readonly traceId?: string;
    readonly spanId?: string;
    readonly parentId?: string;

    /** Aborted when this call's time is up: an on-demand handler's `ctx.signal` follows it. */
    readonly deadline?: AbortSignal;

    /**
     * A long-running contract's own context, which lasts as long as the contract runs. Each call,
     * event or write made from it starts a trace of its own: otherwise everything a listener ever
     * does is one trace, hours long.
     */
    readonly lifetime?: boolean;

    // Pipeline control properties (pre-defined for stability)
    targetNodeID?: string;
    result?: unknown;
    error?: Error | null;
}
