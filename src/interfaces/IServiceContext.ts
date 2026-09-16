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
     * callOnLeader's other half: a per-process, per-key lock with a real TTL (default 10s, capped
     * at 30s -- a lock is not a place to hold state for minutes) and a fencing token. `acquire`
     * throws if `key` is still held once `waitMs` (default 5s) elapses -- not an unbounded wait.
     * `release` only actually releases when `token` still matches the current holder, so a late
     * release from a holder whose TTL already expired can never tear down whoever holds it now.
     */
    acquire(key: string, options?: { ttlMs?: number; waitMs?: number }): Promise<{ token: string }>;

    /** A no-op if `token` isn't the current holder's -- see `acquire`. */
    release(key: string, token: string): void;

    /**
     * `acquire`, run `fn`, `release` -- guaranteed by `finally`, not by remembering to call
     * `release`. Prefer this over a bare acquire/release pair; code between them has to be held to
     * the same discipline as an interrupt handler (fast, nothing that can hang), and this is the
     * version that can't leak a lock for the rest of its TTL just because a code path in between
     * forgot to release it.
     */
    withLock<T>(key: string, fn: () => Promise<T>, options?: { ttlMs?: number; waitMs?: number }): Promise<T>;

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
