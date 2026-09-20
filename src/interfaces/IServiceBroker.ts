import type { IMeshNetwork, IMeshPacket } from './IMeshNetwork.js';
import type { ILogger } from './ILogger.js';
import type { IServiceRegistry } from './IServiceRegistry.js';
import type { IContext } from './IContext.js';
import type { IMeshMeta } from './IMeshMeta.js';
import type { IBrokerPlugin } from './IBrokerPlugin.js';
import type { IMiddleware } from './IInterceptor.js';
import type { ICallOptions, IServiceContext } from './IServiceContext.js';
import type { Database } from '../db/Database.js';
import type { ToolContract } from './IToolContract.js';
import type { AnyCrudContracts } from './ICrudContract.js';
import type { AnyTimeSeriesContracts } from './ITimeSeriesContract.js';
import type { IPlacement } from './IPlacement.js';
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
    /** Resolves the Database override (if any) registered via `registerContract`'s
     *  `options.database` for `toolKey`. Undefined when the tool isn't mounted, or was mounted
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

    /**
     * The registration path (see `docs/CONTRACT_DRIVEN_PLACEMENT.md`): one contract, one handler,
     * no wrapper object. These are on the interface, not just the concrete broker, because a
     * standalone part receives an `IServiceBroker` and registering itself is the entire thing
     * it does.
     */
    registerContract<TIn extends z.ZodTypeAny, TOut extends z.ZodTypeAny>(
        contract: ToolContract<TIn, TOut>,
        handler: (params: z.infer<TIn>, ctx: IServiceContext) => Promise<z.infer<TOut>>,
        options?: {
            replace?: boolean;
            /** Route this contract's CRUD/time-series calls to a Database other than the default. */
            database?: Database;
        },
    ): void;
    unregisterContract(toolKey: string): void;
    listContracts(): ToolContract<z.ZodTypeAny, z.ZodTypeAny>[];

    registerCrud(
        crud: AnyCrudContracts,
        options?: {
            hooks?: Partial<Record<string, { before?: CrudHookFn; after?: CrudHookFn }>>;
            /** Route this collection to a Database other than the broker-wide default. */
            database?: Database;
        },
    ): void;
    /** Mounts a whole time-series collection -- the counterpart to `registerCrud`. */
    registerTimeSeries(contracts: AnyTimeSeriesContracts, options?: { database?: Database }): void;
    registerCrudHook(domain: string, action: string, hooks: { before?: CrudHookFn; after?: CrudHookFn }): void;
    getCrudHooks(domain: string, action: string): { before?: CrudHookFn; after?: CrudHookFn } | undefined;

    registerEventHandler<K extends keyof EventRegistry>(
        name: K,
        handler: (payload: EventRegistry[K], ctx: IServiceContext) => void | Promise<void>,
    ): void;

    /** Mounts every contract a domain declares, wiring each to its own `filePath`'s handler --
     *  the replacement for a hand-written `register(broker)`. See the implementation in
     *  `core/ServiceBroker.ts` for what each `concurrency` kind means at load time. */
    /** Installs the placement layer -- what happens when a call arrives for a contract nothing in
     *  the cluster serves. See `IPlacement`; without one, such a call fails as it always has. */
    setPlacement(placement: IPlacement): void;

    loadDomain(
        domain: string,
        handlers?: ContractHandlerMap,
        options?: {
            resolve?: (contract: ToolContract<z.ZodTypeAny, z.ZodTypeAny>) => Promise<unknown>;
            replace?: boolean;
        },
    ): Promise<{ domain: string; contracts: string[] }>;
}

/**
 * How `loadDomain` finds a handler: tool key -> a thunk returning it.
 *
 * A thunk, not the function itself, so a generated map can be a list of dynamic `import()`s --
 * which both a bundler can inline and an unbundled runtime can resolve from real files, without
 * the map's author choosing between them. Nobody writes one of these by hand; it is generated from
 * the same `filePath` declarations `loadDomain` reads.
 */
export type ContractHandlerMap = Record<string, () => Promise<unknown>>;

/** One side of a CRUD hook -- the shape both `registerCrudHook` and `defineCrud`'s `hooks` take. */
export type CrudHookFn = (value: unknown, ctx: IServiceContext) => Promise<unknown>;
