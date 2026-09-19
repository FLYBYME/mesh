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

    /**
     * `db(domain)`: the safe, direct way to reach a CRUD collection's own actions from inside a
     * handler, without a network/registry hop -- and, critically, *without losing anything*
     * `ctx.call('<domain>.<action>', ...)` already guarantees. Backed by the exact same
     * `CrudExecutor` `DatabaseMiddleware` itself calls (`db/CrudExecutor.ts`), so `scopedBy`
     * resolution, `hidden`-field stripping, event emission, and a module's own
     * `beforeCrud`/`afterCrud` hooks all still apply.
     *
     * `meta` defaults to `ctx.meta` when omitted -- the common case, and the same value `ctx.call()`
     * already threads through implicitly when no `options.meta` override is given (both read the
     * same ambient context). Pass it explicitly only when a handler genuinely needs a *different*
     * scope than its own caller's -- e.g. resolving a part that belongs to some other tenant than
     * whoever is calling this handler right now, the same case `ctx.call(tool, params, { meta })`
     * already covers. An explicit override is *shallow-merged* over `ctx.meta`, matching
     * `ServiceBroker.call`'s own `{ ...activeCtx?.meta, ...options?.meta }` exactly -- passing
     * `{ user: {...} }` replaces the whole ambient `user` object (the shape every real override in
     * this codebase already uses, precisely because a merge that only touched `tenant_id` would
     * leave the caller's own ambient `user.id` masking the intended one underneath it). This is not
     * the "forget to pass meta" foot-gun `ctx.db()` exists to remove: omitting the parameter is what
     * removes it; passing one explicitly is a deliberate choice, made once per lookup, not per
     * method call.
     *
     * `db(domain).find(p)` and `call(\`${domain}.find\`, p)` are typed identically -- both read off
     * the same generated `IServiceToolRegistry['<domain>.find']` entry -- and behave identically;
     * the only difference is that `db()` never goes through registry-based routing (local or
     * remote). This is what `defineCrud`'s ten generated contracts becoming a `broker.call` target
     * (`docs/CONTRACT_DRIVEN_PLACEMENT.md`, "collections as a third dependency kind") is *for*:
     * same-process code reaching its own or another domain's data doesn't need mesh-wide
     * addressability, it needs this.
     *
     * Not a replacement for `database.repo()`/`database.collection()` (`Database.ts`) -- those stay
     * the deliberate, rare escape hatch for code that genuinely needs every tenant's rows or a
     * hidden field's real value (the same already-documented pattern `defineCrud`'s own `hidden`
     * option describes). `db()` is scoped and stripped on purpose; `repo()`/`collection()` are not,
     * also on purpose.
     */
    db<D extends keyof IServiceCollectionRegistry & string>(domain: D, meta?: TMeta): CrudRepo<D>;

    logger: ILogger;
}

/**
 * Looks up one `IServiceToolRegistry` entry by domain + action without directly indexing by a
 * template literal (`IServiceToolRegistry[\`${D}.${A}\`]`) -- that form requires TypeScript to prove
 * the computed key is a member of `IServiceToolRegistry` *at the type's declaration site*, which
 * fails to even compile here in `mesh` itself, where the registry is necessarily empty (populated
 * only by generated code, downstream). Mapping over `keyof IServiceToolRegistry` instead (the same
 * safe pattern `Database.ts`'s `CollectionDomain` already uses) degrades to `never` cleanly when the
 * registry is empty, and resolves to the real entry once generated code has populated it.
 */
type ToolEntry<D extends string, A extends string> = {
    [K in keyof IServiceToolRegistry]: K extends `${D}.${A}` ? IServiceToolRegistry[K] : never;
}[keyof IServiceToolRegistry];

/**
 * The shape `ctx.db(domain)` returns -- one method per generic CRUD action, each typed off the
 * literal same generated `IServiceToolRegistry['<domain>.<action>']` entry `ctx.call()` uses. Not a
 * new type shape asserted to match `IServiceToolRegistry`; the same one, referenced twice.
 */
export type CrudRepo<D extends string> = {
    find(params: ToolEntry<D, 'find'>['params']): Promise<ToolEntry<D, 'find'>['returns']>;
    findOne(params: ToolEntry<D, 'find_one'>['params']): Promise<ToolEntry<D, 'find_one'>['returns']>;
    get(params: ToolEntry<D, 'get'>['params']): Promise<ToolEntry<D, 'get'>['returns']>;
    resolve(params: ToolEntry<D, 'resolve'>['params']): Promise<ToolEntry<D, 'resolve'>['returns']>;
    create(params: ToolEntry<D, 'create'>['params']): Promise<ToolEntry<D, 'create'>['returns']>;
    update(params: ToolEntry<D, 'update'>['params']): Promise<ToolEntry<D, 'update'>['returns']>;
    replace(params: ToolEntry<D, 'replace'>['params']): Promise<ToolEntry<D, 'replace'>['returns']>;
    delete(params: ToolEntry<D, 'delete'>['params']): Promise<ToolEntry<D, 'delete'>['returns']>;
    count(params: ToolEntry<D, 'count'>['params']): Promise<ToolEntry<D, 'count'>['returns']>;
};

/**
 * ServiceActionHandler: The function signature for a tool's implementation.
 */
export type ServiceActionHandler<TInput, TOutput> = (
    args: TInput,
    context: IServiceContext
) => Promise<TOutput>;

export type { IServiceToolRegistry };
