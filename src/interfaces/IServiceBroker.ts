import type { IMeshNetwork, IMeshPacket } from './IMeshNetwork.js';
import type { ILogger } from './ILogger.js';
import type { IServiceRegistry } from './IServiceRegistry.js';
import type { IServiceModule } from './IServiceModule.js';
import type { IContext } from './IContext.js';
import type { IMeshMeta } from './IMeshMeta.js';
import type { IBrokerPlugin } from './IBrokerPlugin.js';
import type { IMiddleware } from './IInterceptor.js';
import type { ICallOptions, IServiceContext } from './IServiceContext.js';
import type { Database } from '../db/Database.js';
import type { ToolContract } from './IToolContract.js';
import type { AnyCrudContracts } from './ICrudContract.js';
import type { z } from 'zod';
/**
 * IServiceBroker — Interface for the central communication kernel.
 */
export interface IServiceBroker {
    readonly nodeID: string;
    readonly logger: ILogger;
    readonly registry: IServiceRegistry;
    readonly network: IMeshNetwork;

    pipe(plugin: IBrokerPlugin): this;
    use(mw: IMiddleware): void;
    useLocal(mw: IMiddleware): void;
    /** Registers a module's tools under its own `domain` by default. Pass `options.key` to mount
     *  it under a different local address instead -- e.g. a second, isolated instance of a domain
     *  already registered elsewhere on this broker (a test-namespace instance alongside the real
     *  one). An aliased mount (`key` !== the module's `domain`) is local-only: it is never
     *  advertised to the Registry, so it can't collide with the real instance's entry or be
     *  routed to remotely -- only reachable via a direct local `broker.call('<key>.<action>', ...)`
     *  on this exact broker. Throws if `key` (or `domain`, when `key` is omitted) is already in use.
     *  Pass `options.database` to route this mount's own CRUD/time-series calls to a different
     *  Database (a different Mongo connection/dbName) than DatabaseModule's shared broker-wide
     *  default -- e.g. an isolated test database for a test-mounted instance. Omitted (the default),
     *  this mount's calls use the same shared database as everything else on the broker. */
    registerModule(module: IServiceModule, options?: { key?: string; database?: Database }): Promise<void>;
    /** Calls the module's own onStop for real resource cleanup, then removes its tools,
     *  schema entries, event subscriptions, and (for a non-aliased mount) registry entry.
     *  Takes the same key `registerModule` mounted it under (its `domain`, unless `options.key`
     *  was passed). Throws if that key isn't currently registered. */
    unregisterModule(mountKey: string): Promise<void>;
    /** Resolves the Database override (if any) registered via registerModule's `options.database`
     *  for the mount that owns `toolKey`. Undefined when the tool isn't mounted, or was mounted
     *  without an override -- callers (DatabaseMiddleware) fall back to their own shared default
     *  Database in either case. */
    getDatabaseForTool(toolKey: string): Database | undefined;
    handlePipeline(ctx: IContext<Record<string, unknown>, IMeshMeta>): Promise<unknown>;
    handleIncomingRPC(packet: IMeshPacket): Promise<unknown>;
    executeRemote(nodeID: string, toolName: string, params: unknown, meta?: Record<string, unknown>): Promise<unknown>;

    /** Typed tool call. */
    call<K extends keyof IServiceToolRegistry>(
        tool: K,
        params: IServiceToolRegistry[K]['params'],
        options?: ICallOptions<IMeshMeta>
    ): Promise<IServiceToolRegistry[K]['returns']>;

    /** Forces `tool` onto whichever node `registry.leaderFor(domain)` currently names. See
     *  IServiceContext.callOnLeader for the full reasoning; this is the same thing at the broker
     *  level, for callers that hold a broker directly rather than a tool handler's ctx. */
    callOnLeader<K extends keyof IServiceToolRegistry>(
        domain: string,
        tool: K,
        params: IServiceToolRegistry[K]['params'],
        options?: ICallOptions<IMeshMeta>
    ): Promise<IServiceToolRegistry[K]['returns']>;

    /** TTL-capped, fencing-tokened per-process lock -- see IServiceContext.acquire/release/withLock
     *  for the full reasoning; these are the same things at the broker level. */
    acquire(key: string, options?: { ttlMs?: number; waitMs?: number }): Promise<{ token: string }>;
    release(key: string, token: string): void;
    withLock<T>(key: string, fn: () => Promise<T>, options?: { ttlMs?: number; waitMs?: number }): Promise<T>;

    /** Typed event emit. */
    emit<K extends keyof EventRegistry>(event: K, payload: EventRegistry[K], options?: { skipNetwork?: boolean }): void;

    on<K extends keyof EventRegistry>(event: K, handler: (payload: EventRegistry[K], packet?: IMeshPacket<EventRegistry[K]>) => void): (() => void);
    off<K extends keyof EventRegistry>(event: K, handler: (payload: EventRegistry[K], packet?: IMeshPacket<EventRegistry[K]>) => void): void;

    getContext(): IContext<Record<string, unknown>, IMeshMeta> | undefined;

    start(): Promise<void>;
    stop(): Promise<void>;

    setNetwork(network: IMeshNetwork): void;
    setRegistry(registry: IServiceRegistry): void;

    registerProvider(name: string, provider: unknown): void;
    getProvider<T>(name: string): T;
    getModule(domain: string): IServiceModule | undefined;

    /**
     * Module-free registration -- the shape a part uses once it has migrated off `ServiceModule`
     * (see `docs/CONTRACT_DRIVEN_PLACEMENT.md`). These are on the interface, not just the concrete
     * broker, because a standalone part receives an `IServiceBroker` and registering itself is the
     * entire thing it does.
     */
    registerContract<TIn extends z.ZodTypeAny, TOut extends z.ZodTypeAny>(
        contract: ToolContract<TIn, TOut>,
        handler: (params: z.infer<TIn>, ctx: IServiceContext) => Promise<z.infer<TOut>>,
        options?: { replace?: boolean },
    ): void;
    unregisterContract(toolKey: string): void;
    listContracts(): ToolContract<z.ZodTypeAny, z.ZodTypeAny>[];

    registerCrud(
        crud: AnyCrudContracts,
        options?: { hooks?: Partial<Record<string, { before?: CrudHookFn; after?: CrudHookFn }>> },
    ): void;
    registerCrudHook(domain: string, action: string, hooks: { before?: CrudHookFn; after?: CrudHookFn }): void;
    getCrudHooks(domain: string, action: string): { before?: CrudHookFn; after?: CrudHookFn } | undefined;

    registerEventHandler<K extends keyof EventRegistry>(
        name: K,
        handler: (payload: EventRegistry[K], ctx: IServiceContext) => void | Promise<void>,
    ): void;
}

/** One side of a CRUD hook -- the shape both `registerCrudHook` and `ServiceModule.mountCrudHook` take. */
export type CrudHookFn = (value: unknown, ctx: IServiceContext) => Promise<unknown>;
