import type { ILogger } from './ILogger.js';
import type { IServiceBroker } from './IServiceBroker.js';
import type { IMeshMeta } from './IMeshMeta.js';

export interface ICallOptions<TMeta = IMeshMeta> {
    nodeID?: string;
    timeout?: number;
    meta?: TMeta;
}

/**
 * Global Registry Declarations:
 * We use a global namespace so that multiple physical copies of the @flybyme/mesh package
 * (common in multi-repo/multi-package environments) can all contribute to the same
 * strictly-typed registries.
 */
declare global {
    /**
     * IServiceToolRegistry: The global registry mapping tool keys to their parameter and return types.
     * Populated by generated code.
     */
    interface IServiceToolRegistry {
        // Generated tools will appear here like:
        // 'demo.hello': { params: z.infer<...>, returns: z.infer<...> }
    }

    /**
     * EventRegistry: The global registry for strictly-typed events.
     * Populated by generated code.
     */
    interface EventRegistry {
        // Generated events will appear here like:
        // 'demo.hello.sent': { ... }
    }
}

/**
 * IServiceContext: The strictly-typed execution context injected into every tool handler.
 */
export interface IServiceContext<TMeta = IMeshMeta> {
    /** The service broker instance handling this execution context. */
    readonly broker: IServiceBroker;

    /** Unique correlation ID for distributed tracing. */
    readonly correlationId: string;

    /** The node ID this context is executing on. */
    readonly nodeID: string;

    /** Optional abort signal for cancellation. */
    readonly signal?: AbortSignal;

    /** Context metadata. */
    readonly meta?: TMeta;

    /** Strictly typed tool call. */
    call<K extends keyof IServiceToolRegistry>(
        tool: K,
        params: IServiceToolRegistry[K]['params'],
        options?: ICallOptions<TMeta>
    ): Promise<IServiceToolRegistry[K]['returns']>;

    /**
     * Forces `tool` to run on whichever node Registry.leaderFor(domain) currently names, instead
     * of wherever the load balancer would otherwise pick. This is what makes a conditional claim
     * (a hold, a queue lease, a concurrency-limited acquire) safe under real multi-node
     * concurrency without assuming anything about the storage layer's own atomicity: the call only
     * ever executes on one physical process at a time. Throws if no node currently runs `domain`.
     */
    callOnLeader<K extends keyof IServiceToolRegistry>(
        domain: string,
        tool: K,
        params: IServiceToolRegistry[K]['params'],
        options?: { timeout?: number }
    ): Promise<IServiceToolRegistry[K]['returns']>;

    /**
     * callOnLeader's other half: a per-process, per-key promise chain, not a database lock. Two
     * calls to `withLock(key, fn)` for the *same* key on this process never run `fn` concurrently
     * -- a second caller's `fn` starts only once the first's has settled, regardless of whether it
     * resolved or rejected. Different keys never wait on each other. Combined with callOnLeader
     * (one node runs this domain's claims), that closes the same-node race callOnLeader alone
     * doesn't: two overlapping calls reaching that one process for the same key can still
     * interleave a read and a write without this.
     */
    withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;

    /** Strictly typed event dispatch. */
    emit<K extends keyof EventRegistry>(
        event: K,
        payload: EventRegistry[K],
        options?: { skipNetwork?: boolean }
    ): void;

    logger: ILogger;
}

/**
 * ServiceActionHandler: The function signature for a tool's implementation.
 */
export type ServiceActionHandler<TInput, TOutput> = (
    args: TInput,
    context: IServiceContext
) => Promise<TOutput>;

export type { IServiceToolRegistry };
