import type { ContractHandlerMap, IServiceBroker } from '../interfaces/IServiceBroker.js';
import type { IPlacement } from '../interfaces/IPlacement.js';
import { PlacementScope } from './PlacementScope.js';
import type { ILogger } from '../interfaces/ILogger.js';
import type { IMeshNetwork } from '../interfaces/IMeshNetwork.js';
import type { IServiceRegistry } from '../interfaces/IServiceRegistry.js';
import type { IContext } from '../interfaces/IContext.js';
import type { IMeshPacket } from '../interfaces/IMeshNetwork.js';
import type { IBrokerPlugin } from '../interfaces/IBrokerPlugin.js';
import type { IMiddleware } from '../interfaces/IInterceptor.js';
import type { IMeshMeta } from '../interfaces/IMeshMeta.js';
import type { TimerHandle } from '../interfaces/ITimer.js';
import type { IServiceContext, ICallOptions, CrudRepo } from '../interfaces/IServiceContext.js';
import type { Database } from '../db/Database.js';
import { CrudExecutor } from '../db/CrudExecutor.js';
import { globalContractRegistry, type ToolContract } from '../interfaces/IToolContract.js';
import type { AnyCrudContracts } from '../interfaces/ICrudContract.js';
import type { AnyTimeSeriesContracts } from '../interfaces/ITimeSeriesContract.js';
import { SafeTimer } from '../utils/SafeTimer.js';
import type { EventHandlerDefinition } from '../interfaces/IEventHandler.js';
import { eventScope, scopeOfOccurrence } from './EventScope.js';
import './MeshEvents.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { EventEmitter } from 'eventemitter3';
import { ContextStack } from './ContextStack.js';
import { ClientError, MeshError, errorFromWire, isMeshError } from './MeshError.js';

/**
 * formatZodIssues: renders a params validation failure as "field: reason; field: reason".
 *
 * `${zodError}` stringifies to a multi-line JSON dump of the whole issue array, which is unusable
 * in a log line and unusable in an API response. The caller needs to know which field was wrong.
 */
function formatZodIssues(error: unknown): string {
    if (error instanceof z.ZodError) {
        return error.issues
            .map(issue => {
                const path = issue.path.join('.');
                return path ? `${path}: ${issue.message}` : issue.message;
            })
            .join('; ');
    }
    return String(error);
}

interface LocalTool {
    handler: (ctx: IContext<Record<string, unknown>, Record<string, unknown>>) => Promise<unknown>;
    highSecurity?: boolean;
}

export const MeshToolSchemaRegistry: Map<string, {
    params?: z.ZodTypeAny,
    returns?: z.ZodTypeAny,
    mutates?: boolean,
    timeout?: number,
    isCrud?: boolean,
    isTimeSeries?: boolean,
    domain?: string,
    scopedBy?: string
}> = new Map();

const MAX_RPC_TIMEOUT = 3600000; // 1 hour

/** One side of a CRUD hook -- the shape `registerCrudHook` and `defineCrud`'s `hooks` both take. */
export type CrudHook = (value: unknown, ctx: IServiceContext) => Promise<unknown>;

/** One thing a `withOwner` scope registered, as `unregisterOwner` needs to find it again. */
type OwnedRegistration =
    | { readonly kind: 'contract'; readonly key: string }
    | { readonly kind: 'crudHook'; readonly key: string; readonly hooks: { before?: CrudHook; after?: CrudHook } }
    | { readonly kind: 'eventHandler'; readonly id: string };

export class ServiceBroker implements IServiceBroker {
    /**
     * **Validate a result against its contract, tolerating a projection but never widening one.**
     *
     * Both RPC paths used to do this inline, and both did it wrong in the same way:
     *
     *     const isCrudProjection = schema.isCrud && ctx.params && (ctx.params.fields !== undefined);
     *     if (isCrudProjection) {
     *         return result;
     *     }
     *     return schema.returns.parse(result);
     *
     * The parse is what strips keys the output schema does not declare, and a contract that
     * publishes a collection holding a secret — a password hash, a token — relies on exactly that.
     * Skipping it on a projected read made the guarantee **one query parameter deep**: ask for
     * `fields` and the stored document came back untouched, including the field the schema was
     * written to withhold, because a mongo projection is an allow-list and `fields: 'passwordHash'`
     * is a legal thing to write.
     *
     * The reason for the bypass was real and is kept. A projection returns a *partial* document, so
     * a schema with required fields rejects it: `find({ fields: 'email' })` carries no `createdAt`
     * and parsing would fail on a read that is correct. So a projected read is parsed against a
     * **partial** schema instead of not being parsed at all — missing keys are allowed, extra keys
     * are still removed, and the two properties stop being traded against each other.
     *
     * `deepPartial` rather than `partial` because a projection may name a nested path (`a.b`), which
     * leaves the parent present and incomplete.
     *
     * Static and exported so the behaviour can be tested without standing up a broker, a registry
     * and a database — see `__tests__/CrudProjection.spec.ts`, which also asserts that both call
     * sites still route through here.
     */
    public static applyReturns(
        returns: z.ZodTypeAny,
        projected: boolean,
        result: unknown,
    ): unknown {
        if (!projected) return returns.parse(result);
        return ServiceBroker.partialised(returns).parse(result);
    }

    /**
     * The same schema with its object fields made optional, through the wrappers a crud contract
     * actually uses: `z.array(...)` for `find`, `.nullable()` for `find_one` and `get`, and a bare
     * object for the rest. Anything else — `count`'s number, a literal — is returned unchanged,
     * because there is nothing in it a projection could have omitted.
     */
    private static partialised(schema: z.ZodTypeAny): z.ZodTypeAny {
        if (schema instanceof z.ZodArray) {
            return z.array(ServiceBroker.partialised(schema.element as z.ZodTypeAny));
        }
        if (schema instanceof z.ZodNullable) {
            return ServiceBroker.partialised(schema.unwrap() as z.ZodTypeAny).nullable();
        }
        if (schema instanceof z.ZodOptional) {
            return ServiceBroker.partialised(schema.unwrap() as z.ZodTypeAny).optional();
        }
        if (schema instanceof z.ZodObject) {
            return schema.deepPartial();
        }
        return schema;
    }

    private localTools = new Map<string, LocalTool>();
    private isStarted: boolean = false;
    // ── ctx.signal, and the two lifetimes it can have ────────────────────────────────────────
    // A `long-running`/`interval` contract's signal belongs to its *registration*: one controller
    // per tool key, created when it mounts, aborted when it unmounts. That is the whole of stopping
    // such a contract -- see IServiceContext.signal.
    private lifetimeAborts = new Map<string, AbortController>();
    // An `on-demand` contract's signal belongs to the one call, so it can't be cached by key --
    // but broker.stop() still has to be able to cancel whatever is in flight, hence the set.
    private inFlightAborts = new Set<AbortController>();
    // Broker-owned timers for `interval` contracts (see startIntervalContract). Keyed by tool key
    // so unregisterContract can clear exactly one.
    private intervalTimers = new Map<string, TimerHandle>();
    // Interval contracts registered before start() -- their timers begin when the broker does, not
    // at mount time, so a part loaded onto a not-yet-started node doesn't tick against half-wired
    // infrastructure.
    private pendingIntervals = new Map<string, ToolContract<z.ZodTypeAny, z.ZodTypeAny>>();
    // ── Placement ────────────────────────────────────────────────────────────────────────────
    // Optional, and absent by default: with no provider, a call for a tool nothing serves fails
    // exactly as it always has. See IPlacement.
    private placement?: IPlacement;
    // One attempt per tool at a time. Twenty concurrent calls for a tool nothing serves should
    // cause one load, not twenty -- and the nineteen that arrive second should wait for it rather
    // than failing while it is in progress.
    private placementInFlight = new Map<string, Promise<string | undefined>>();
    // toolKey -> a Database other than the broker-wide default, for that one tool. See
    // getDatabaseForTool.
    private toolDatabases = new Map<string, Database>();
    // Every contract mounted on this broker, by tool key -- `registerContract` puts them here and
    // `unregisterContract` takes exactly one back out.
    private standaloneContracts = new Map<string, ToolContract<z.ZodTypeAny, z.ZodTypeAny>>();
    // `<domain>.<action>` -> CRUD hooks (registerCrudHook, or a contract's own `hooks`).
    private standaloneCrudHooks = new Map<string, { before?: CrudHook; after?: CrudHook }>();
    // Every event handler subscribed through `registerEventHandler`, by registration id -- each
    // with the unsubscribe that also aborts the `ctx.signal` its handler received.
    private readonly eventHandlers = new Map<string, { readonly unregister: () => void }>();
    // Unscopable events a handler has run for, so the log says so once per event name, not per event.
    private readonly unscopedHandlerEventsLogged = new Set<string>();

    // Registration ownership -- see `withOwner`. The owner in effect follows async lineage, so a
    // part's `await`ing `register(broker)` is attributed however deep it registers.
    private static readonly ownerStorage: AsyncLocalStorage<string> | undefined =
        typeof AsyncLocalStorage === 'function' ? new AsyncLocalStorage<string>() : undefined;
    // Without AsyncLocalStorage only the synchronous part of `withOwner`'s `fn` is attributed. A
    // browser bundle never loads parts, so it never needs more.
    private ownerFallback: string | undefined;
    private readonly ownedRegistrations = new Map<string, OwnedRegistration[]>();
    // Which owner mounted each contract key *now*, so an owner that was since overridden (a
    // `replace: true` by someone else) cannot unmount the contract that replaced its own.
    private readonly contractOwners = new Map<string, string>();

    private globalMiddleware: IMiddleware[] = [];
    private localMiddleware: IMiddleware[] = [];

    private plugins: IBrokerPlugin[] = [];
    private localEvents: EventEmitter = new EventEmitter();
    private patternWrappers = new WeakMap<Function, (...args: unknown[]) => void>();

    public registry!: IServiceRegistry;
    public network!: IMeshNetwork;
    public resiliency = {} as Record<string, unknown>;

    private providers = new Map<string, unknown>();

    private pendingRequests = new Map<string, {
        resolve: (val: unknown) => void,
        reject: (err: Error) => void,
        timeout: TimerHandle
    }>();

    constructor(
        public readonly nodeID: string,
        public readonly logger: ILogger
    ) { }

    private evaluateTimeout(requestedTimeout?: number, schemaTimeout?: number, remoteTimeout?: number): number {
        const timeout = requestedTimeout !== undefined ? requestedTimeout : (schemaTimeout !== undefined ? schemaTimeout : (remoteTimeout !== undefined ? remoteTimeout : 10000));
        if (timeout === 0 || timeout > MAX_RPC_TIMEOUT) {
            return MAX_RPC_TIMEOUT;
        }
        return timeout;
    }

    public registerProvider(name: string, provider: unknown): void {
        this.providers.set(name, provider);
    }

    public getProvider<T>(name: string): T {
        return this.providers.get(name) as T;
    }

    /**
     * The Database this tool's CRUD/time-series calls should use, when it is not the broker-wide
     * default -- a different Mongo connection or dbName for one domain.
     *
     * Registered per contract (`registerContract`'s `options.database`, forwarded by `loadDomain`),
     * which is the granularity that actually matters: "this collection lives elsewhere" is a fact
     * about a domain, not about whatever happened to mount it. Returns undefined when the tool
     * isn't mounted or has no override, and `DatabaseMiddleware`/`CrudExecutor` fall back to the
     * shared default in either case.
     */
    public getDatabaseForTool(toolKey: string): Database | undefined {
        return this.toolDatabases.get(toolKey);
    }

    /**
     * Backs `ctx.db(domain)` (`IServiceContext.ts`) -- delegates to `CrudExecutor.makeCrudRepo`, the
     * one real implementation (also used by `CrudExecutor` itself for a `beforeCrud`/`afterCrud`
     * hook's own `ctx.db()`), so both `serviceCtx` build sites below share it instead of duplicating
     * nine methods twice over.
     */
    private makeCrudRepo<D extends keyof IServiceCollectionRegistry & string>(
        domain: D,
        meta: Record<string, unknown> | undefined
    ): CrudRepo<D> {
        return CrudExecutor.makeCrudRepo(this, domain, meta);
    }

    public pipe(plugin: IBrokerPlugin): this {
        this.plugins.push(plugin);
        plugin.onRegister(this);
        return this;
    }

    public setNetwork(network: IMeshNetwork): void {
        this.network = network;
        this.setupNetworkListeners();
    }

    public setRegistry(registry: IServiceRegistry): void {
        this.registry = registry;
    }

    private setupNetworkListeners() {
        if (!this.network) return;

        // Every link change on this node, told to this node and (through the links still up) to
        // its peers -- see core/MeshEvents.
        this.network.onLinkChange?.((change) => {
            this.emit('mesh.link.changed', { nodeID: this.nodeID, peer: change.peer, state: change.state, at: Date.now() });
        });

        this.network.onMessage('*', (data: unknown, packet: IMeshPacket) => {
            if (packet.type === 'RESPONSE' || packet.type === 'RESPONSE_ERROR') {
                const correlationId = (packet.meta?.correlationID || packet.id) as string;
                const pending = this.pendingRequests.get(correlationId);
                if (pending) {
                    SafeTimer.clearTimeout(pending.timeout);
                    this.pendingRequests.delete(correlationId);
                    try {
                        if (packet.type === 'RESPONSE_ERROR') {
                            pending.reject(errorFromWire(packet.error ?? packet.data));
                        } else {
                            pending.resolve(packet.data);
                        }
                    } catch (err) {
                        this.logger.error(`[ServiceBroker] Bridge RPC error: ${err}`);
                    }
                }
            } else if (packet.type === 'REQUEST') {
                this.handleIncomingRPC(packet).then(res => {
                    this.network.send(packet.senderNodeID, packet.topic, res, {
                        type: 'RESPONSE',
                        id: packet.id,
                        meta: { correlationID: packet.id }
                    }).catch(err => this.logger.error(`[ServiceBroker] Failed to send RESPONSE: ${err}`));
                }).catch(err => {
                    const message = err instanceof Error ? err.message : String(err);
                    // A MeshError's `code` and `status` travel too. Sending only the message meant
                    // every meaningful status collapsed to 500 the moment a handler ran on another
                    // node: the same call answered 404 locally and 500 remotely. Placement makes
                    // where a handler runs a scheduling detail, so that difference had become both
                    // routine and non-deterministic.
                    // isMeshError, not instanceof: the handler that threw this may well live in a
                    // precompiled part loaded with require(), which under tsx is a different copy
                    // of this module and therefore a different MeshError class. See
                    // MESH_ERROR_BRAND -- that mismatch is exactly what kept turning a remote 404
                    // into a 500 while every test passed.
                    const wire = isMeshError(err)
                        ? err.toJSON()
                        : { message, data: { stack: err instanceof Error ? err.stack : undefined } };

                    // The same object as both payload and envelope error: a transport settles its
                    // own pending RPC and reads one of them, and which one depends on the
                    // transport. Sending only `{ message }` as the payload is why the broker-side
                    // fix alone changed nothing over WebSocket.
                    this.network.send(packet.senderNodeID, packet.topic, wire, {
                        type: 'RESPONSE_ERROR',
                        id: packet.id,
                        meta: { correlationID: packet.id },
                        error: wire
                    }).catch(sendErr => this.logger.error(`[ServiceBroker] Failed to send RESPONSE_ERROR: ${sendErr}`));
                });
            } else if (packet.type === 'EVENT') {
                this._triggerLocal(packet.topic, packet.data, packet);
            }
        });
    }

    public use(mw: IMiddleware): void {
        this.globalMiddleware.push(mw);
    }

    public useLocal(mw: IMiddleware): void {
        this.localMiddleware.push(mw);
    }

    public getContext(): IContext<Record<string, unknown>, Record<string, unknown>> | undefined {
        return ContextStack.getContext() as IContext<Record<string, unknown>, Record<string, unknown>> | undefined;
    }

    public on<K extends keyof EventRegistry>(event: K, handler: (payload: EventRegistry[K], packet?: IMeshPacket<EventRegistry[K]>) => void): (() => void) {
        const topic = String(event);
        if (topic.includes('*')) {
            const regex = new RegExp('^' + topic
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                .replace(/\\\*/g, '.*')
                + '$');
            const wrapper = (payload: any, packet?: IMeshPacket<any>) => {
                const topicToTest = packet?.topic || topic;
                if (regex.test(topicToTest)) {
                    handler(payload, packet);
                }
            };
            this.patternWrappers.set(handler as Function, wrapper as (...args: unknown[]) => void);
            this.localEvents.on('__pattern_event', wrapper);
        } else {
            this.localEvents.on(topic, handler);
        }

        return () => this.off(event, handler);
    }

    public subscribe(event: string, handler: (payload: unknown) => void): () => void {
        const listener = (payload: unknown): void => handler(payload);
        this.localEvents.on(event, listener);
        return () => { this.localEvents.off(event, listener); };
    }

    public off<K extends keyof EventRegistry>(event: K, handler: (payload: EventRegistry[K], packet?: IMeshPacket<EventRegistry[K]>) => void): void {
        const topic = String(event);
        if (topic.includes('*')) {
            const wrapper = this.patternWrappers.get(handler as Function);
            if (wrapper) this.localEvents.off('__pattern_event', wrapper);
        } else {
            this.localEvents.off(topic, handler);
        }
    }

    public _triggerLocal(topic: string, data: unknown, packet: IMeshPacket): void {
        this.localEvents.emit(topic, data, packet);
        this.localEvents.emit('__pattern_event', data, packet);
    }

    /**
     * The `IServiceContext` an event subscriber receives (`registerEventHandler`) -- a real one,
     * `signal` included. It used to be an untyped record, missing `signal`, cast to fit.
     */
    private makeEventContext(name: string, payload: unknown, packet: IMeshPacket | undefined, signal: AbortSignal): IServiceContext {
        const occurrence = scopeOfOccurrence(name, payload);
        if (occurrence === undefined && !this.unscopedHandlerEventsLogged.has(name)) {
            this.unscopedHandlerEventsLogged.add(name);
            const scope = eventScope(name);
            const why = scope !== undefined && scope !== 'global' && 'refusal' in scope ? scope.refusal : 'nothing here defines it';
            this.logger.debug(`[ServiceBroker] Event handlers for "${name}" run with no tenant: ${why}`);
        }
        const meta: IMeshMeta = {
            ...(packet?.meta ?? {}),
            ...(occurrence !== undefined && 'scope' in occurrence ? { tenant_id: occurrence.scope } : {}),
        };

        return {
            broker: this,
            correlationId: packet?.id || randomUUID(),
            nodeID: this.nodeID,
            signal,
            meta,
            call: async <K extends keyof IServiceToolRegistry>(
                tool: K,
                params: IServiceToolRegistry[K]['params'],
                options?: ICallOptions<IMeshMeta>
            ): Promise<IServiceToolRegistry[K]['returns']> =>
                // On behalf of the event's tenant unless the handler says otherwise.
                this.call(tool, params, { ...options, meta: { ...meta, ...options?.meta } }),
            callOnLeader: async <K extends keyof IServiceToolRegistry>(
                leaderDomain: string,
                tool: K,
                params: IServiceToolRegistry[K]['params'],
                options?: { timeout?: number }
            ): Promise<IServiceToolRegistry[K]['returns']> => this.callOnLeader(leaderDomain, tool, params, options),
            acquire: (key: string, options?: { ttlMs?: number; waitMs?: number }) => this.acquire(key, options),
            release: (key: string, token: string) => this.release(key, token),
            withLock: <T>(key: string, fn: () => Promise<T>, options?: { ttlMs?: number; waitMs?: number }): Promise<T> => this.withLock(key, fn, options),
            emit: <K extends keyof EventRegistry>(
                event: K,
                payload: EventRegistry[K],
                options?: { skipNetwork?: boolean }
            ) => this.emit(event, payload, options),
            db: <D extends keyof IServiceCollectionRegistry & string>(domain: D, override?: IMeshMeta): CrudRepo<D> =>
                this.makeCrudRepo(domain, override ? { ...meta, ...override } : meta),
            logger: this.logger
        };
    }

    /**
     * The per-contract half of mounting: the schema registry entry, the `serviceCtx` a handler
     * receives, the `leaderScoped` redirect. `registerContract` is its only caller.
     *
     * `leaderDomain` is separate from `contract.domain` on purpose: a part can own contracts
     * across more than one real domain (serve.catalog owns serve.repo/serve.part/...), and
     * `leaderFor` has to be asked about the domain that's actually *advertised*, not the contract's
     * own sub-domain. Usually the two are the same thing.
     */
    private wireLocalTool(
        toolKeyStr: string,
        contract: ToolContract<z.ZodTypeAny, z.ZodTypeAny>,
        leaderDomain: string,
        dispatch: (params: Record<string, unknown>, serviceCtx: unknown) => Promise<unknown>,
    ): void {
        MeshToolSchemaRegistry.set(toolKeyStr, {
            params: contract.inputSchema as z.ZodTypeAny,
            returns: contract.outputSchema as z.ZodTypeAny,
            mutates: contract.destructive,
            isCrud: contract.isCrud,
            isTimeSeries: contract.isTimeSeries,
            domain: contract.domain,
            timeout: contract.timeout,
            scopedBy: contract.scopedBy
        });

        // A long-running/interval contract's signal outlives any single invocation -- one
        // controller for the registration, created here so both mount paths (module and
        // standalone) get identical behavior rather than only the one that remembered to.
        if (contract.concurrency !== 'on-demand' && !this.lifetimeAborts.has(toolKeyStr)) {
            this.lifetimeAborts.set(toolKeyStr, new AbortController());
        }

        this.localTools.set(toolKeyStr, {
            handler: async (ctx: IContext<Record<string, unknown>, Record<string, unknown>>) => {
                const lifetimeAbort = this.lifetimeAborts.get(toolKeyStr);
                const abort = lifetimeAbort ?? new AbortController();
                if (lifetimeAbort === undefined) this.inFlightAborts.add(abort);

                const serviceCtx = {
                    broker: this,
                    signal: abort.signal,
                    meta: ctx.meta,
                    correlationId: ctx.correlationID || randomUUID(),
                    nodeID: this.nodeID,
                    call: async <K extends keyof IServiceToolRegistry>(
                        tool: K,
                        params: IServiceToolRegistry[K]['params'],
                        options?: { nodeID?: string; timeout?: number }
                    ): Promise<IServiceToolRegistry[K]['returns']> => {
                        const result = await this.call(tool, params, options);
                        return result as IServiceToolRegistry[K]['returns'];
                    },
                    callOnLeader: async <K extends keyof IServiceToolRegistry>(
                        otherDomain: string,
                        tool: K,
                        params: IServiceToolRegistry[K]['params'],
                        options?: { timeout?: number }
                    ): Promise<IServiceToolRegistry[K]['returns']> => this.callOnLeader(otherDomain, tool, params, options),
                    acquire: (key: string, options?: { ttlMs?: number; waitMs?: number }) => this.acquire(key, options),
                    release: (key: string, token: string) => this.release(key, token),
                    withLock: <T>(key: string, fn: () => Promise<T>, options?: { ttlMs?: number; waitMs?: number }): Promise<T> => this.withLock(key, fn, options),
                    emit: <K extends keyof EventRegistry>(
                        event: K,
                        payload: EventRegistry[K],
                        options?: { skipNetwork?: boolean }
                    ) => this.emit(event, payload, options),
                    // Shallow merge, same as ServiceBroker.call's own `{ ...activeCtx?.meta, ...options?.meta }`
                    // -- an override replaces top-level keys (e.g. a whole `user` object) rather than
                    // silently keeping the ambient one underneath it, exactly matching what
                    // `ctx.call(tool, params, { meta })` already does for the same override.
                    db: <D extends keyof IServiceCollectionRegistry & string>(dbDomain: D, meta?: Record<string, unknown>): CrudRepo<D> =>
                        this.makeCrudRepo(dbDomain, meta ? { ...ctx.meta, ...meta } : ctx.meta),
                    logger: this.logger
                };
                // Resolved and forwarded here, once, rather than inside every handler that needs
                // it. Runs again, harmlessly, once this same call actually reaches the leader
                // (this check sees `leader.nodeID === this.nodeID` there and falls through).
                if (contract.leaderScoped === true) {
                    const leader = this.registry?.leaderFor(leaderDomain);
                    if (leader !== undefined && leader.nodeID !== this.nodeID) {
                        if (lifetimeAbort === undefined) this.inFlightAborts.delete(abort);
                        return this.callOnLeader(leaderDomain, toolKeyStr as keyof IServiceToolRegistry, ctx.params as never);
                    }
                }
                try {
                    return await dispatch(ctx.params, serviceCtx);
                } finally {
                    // Only a per-call controller is finished here -- a lifetime one stays live for
                    // the next invocation, and for whatever the handler left running behind it.
                    if (lifetimeAbort === undefined) this.inFlightAborts.delete(abort);
                }
            },
            highSecurity: contract.destructive === true
        });
    }

    /**
     * Mounts one contract and its handler -- no wrapper, no class, no grouping. This is the
     * broker-side counterpart to `IServiceRegistry.registerContract`, and together they're what
     * "every contract stands alone" (docs/CONTRACT_DRIVEN_PLACEMENT.md) actually requires: a
     * contract can be loaded, mounted, advertised, routed to, and unmounted entirely on its own.
     */
    public registerContract<TIn extends z.ZodTypeAny, TOut extends z.ZodTypeAny>(
        contract: ToolContract<TIn, TOut>,
        handler: (params: z.infer<TIn>, ctx: IServiceContext) => Promise<z.infer<TOut>>,
        options?: { replace?: boolean; database?: Database },
    ): void {
        const toolKeyStr = `${contract.domain}.${contract.action}`;
        // Refusing by default is deliberate, and immediately worth it: it surfaced a real collision
        // that the old `ServiceModule.mountTool`'s plain Map had resolved silently by last-write-wins
        // (`identity.ticket.resolve` -- a hand-written contract landing on the same key as the one
        // `defineCrud` generates for that collection, with entirely different semantics). An
        // intentional override is still fine; it just has to say so.
        if (this.localTools.has(toolKeyStr) && options?.replace !== true) {
            throw new Error(`[ServiceBroker] Cannot register contract: "${toolKeyStr}" is already mounted on this node. Pass { replace: true } if overriding it is intended.`);
        }

        const asAny = contract as unknown as ToolContract<z.ZodTypeAny, z.ZodTypeAny>;
        this.wireLocalTool(toolKeyStr, asAny, contract.domain, (params, serviceCtx) =>
            handler(params as z.infer<TIn>, serviceCtx as IServiceContext));

        this.standaloneContracts.set(toolKeyStr, asAny);
        globalContractRegistry.register(asAny);

        const owner = this.currentOwner();
        if (owner !== undefined) {
            this.contractOwners.set(toolKeyStr, owner);
            this.recordOwned(owner, { kind: 'contract', key: toolKeyStr });
        } else {
            this.contractOwners.delete(toolKeyStr);
        }

        // Per contract, not per mount: "this collection lives in another database" is a fact about
        // the domain, and survives however it came to be mounted.
        if (options?.database !== undefined) {
            this.toolDatabases.set(toolKeyStr, options.database);
        }

        // A hook the contract declares is wired wherever the contract is mounted -- here, rather
        // than in `loadDomain` alone, so `registerCrud` and every other path that mounts a
        // collection gets it too. See `defineCrud`'s `hooks` option: the point is that there is no
        // separate registration step anyone can forget.
        if (asAny.hooks !== undefined) {
            this.registerCrudHook(asAny.domain, asAny.action, asAny.hooks as { before?: CrudHook; after?: CrudHook });
        }

        this.registry?.registerContract(asAny as ToolContract);

        // An interval contract's timer starts as soon as it is mounted on a running broker --
        // mounting it *is* scheduling it. On a broker that hasn't started yet it waits for start(),
        // so a part loaded during boot doesn't tick against half-wired infrastructure.
        if (asAny.concurrency === 'interval') {
            if (this.isStarted) this.startIntervalContract(toolKeyStr, asAny);
            else this.pendingIntervals.set(toolKeyStr, asAny);
        }

        this.logger.info(`[ServiceBroker] Contract registered successfully: ${toolKeyStr}`);
    }

    /**
     * `registerContract`'s other half -- unmounts exactly one contract, leaving every sibling
     * contract under the same domain untouched. That granularity is the point: a standalone
     * on-demand contract has to be evictable on its own, not only as part of tearing down every
     * contract a domain mounted.
     */
    public unregisterContract(toolKeyStr: string): void {
        const contract = this.standaloneContracts.get(toolKeyStr);
        if (!contract) {
            throw new Error(`[ServiceBroker] Cannot unregister contract '${toolKeyStr}': not registered as a standalone contract`);
        }

        // Order matters: abort before unwiring, so a long-running handler's teardown
        // (`ctx.signal.addEventListener('abort', ...)` -- closing its listener, clearing its own
        // state) runs while the contract is still fully mounted. This abort *is* the stop: there is
        // no onStop for a standalone contract, by design.
        const lifetimeAbort = this.lifetimeAborts.get(toolKeyStr);
        if (lifetimeAbort) {
            lifetimeAbort.abort();
            this.lifetimeAborts.delete(toolKeyStr);
        }
        SafeTimer.clearInterval(this.intervalTimers.get(toolKeyStr));
        this.intervalTimers.delete(toolKeyStr);
        this.pendingIntervals.delete(toolKeyStr);

        this.localTools.delete(toolKeyStr);
        MeshToolSchemaRegistry.delete(toolKeyStr);
        globalContractRegistry.delete(toolKeyStr);
        this.standaloneContracts.delete(toolKeyStr);
        this.toolDatabases.delete(toolKeyStr);
        this.contractOwners.delete(toolKeyStr);

        this.registry?.unregisterContract(toolKeyStr);

        this.logger.info(`[ServiceBroker] Contract unregistered: ${toolKeyStr}`);
    }

    /**
     * The broker-owned timer behind `concurrency: 'interval'`.
     *
     * A recurring job used to mean a class with a `timer` field, a `setInterval` in `onStart`, a
     * `clearInterval` in `onStop`, and a hand-rolled guard against ticks overlapping -- the same
     * four things written slightly differently in every service that had one. Declaring
     * `intervalMs` replaces all of it: the contract says how often, and its handler is an ordinary
     * handler that does one pass.
     *
     * Two behaviors are built in here rather than left to each handler:
     *
     * - **No overlap.** A tick that is still running when the next one is due skips it outright
     *   (rather than queueing), because a handler that consistently runs longer than its period
     *   would otherwise accumulate concurrent copies of itself forever.
     * - **`leaderScoped` means a cluster singleton.** Every node that has the contract loaded also
     *   has this timer; on a non-leader the tick is dropped *here*. It deliberately does not fall
     *   through to `wireLocalTool`'s leaderScoped redirect -- that would forward each non-leader's
     *   tick to the leader, which has its own timer, and the leader would then run N times per
     *   period instead of once.
     */
    private startIntervalContract(toolKeyStr: string, contract: ToolContract<z.ZodTypeAny, z.ZodTypeAny>): void {
        if (this.intervalTimers.has(toolKeyStr)) return;

        let running = false;
        const timer = setInterval(() => {
            if (running) return;
            if (contract.leaderScoped === true) {
                const leader = this.registry?.leaderFor(contract.domain);
                if (leader !== undefined && leader.nodeID !== this.nodeID) return;
            }

            running = true;
            // Through `call`, not a direct dispatch, so a tick gets the same validation, middleware
            // and tracing as any other invocation -- pinned to this node, since an interval
            // contract ticks where it is loaded and must never be routed to a peer.
            void this.call(toolKeyStr as keyof IServiceToolRegistry, {} as never, { nodeID: this.nodeID })
                .catch((err: unknown) => {
                    this.logger.error(`[ServiceBroker] interval contract "${toolKeyStr}" threw`, err);
                })
                .finally(() => { running = false; });
        }, contract.intervalMs);

        // A pending tick must not be the reason a process refuses to exit.
        SafeTimer.unref(timer);
        this.intervalTimers.set(toolKeyStr, timer);
        this.logger.info(`[ServiceBroker] interval contract "${toolKeyStr}" ticking every ${contract.intervalMs}ms`);
    }

    /**
     * Installs the placement layer -- what happens when a call arrives for a contract nothing in
     * the cluster serves. See `IPlacement`; without one, such a call fails as it always has.
     */
    public setPlacement(placement: IPlacement): void {
        this.placement = placement;
        this.logger.info('[ServiceBroker] Placement provider installed');
    }

    /**
     * One placement attempt per tool name, shared by everyone waiting on it.
     *
     * Re-entrancy is refused rather than queued: if placing `X` leads back here for `X`, awaiting
     * the in-flight attempt would be awaiting ourselves. Returning `undefined` instead lets that
     * inner call fail with the ordinary "nobody advertises this" error, which is a bad outcome but
     * a finite one -- and it names a real mistake in the provider (see `IPlacement`: a provider
     * addresses its own calls explicitly).
     */
    private async ensurePlaced(toolName: string): Promise<string | undefined> {
        // Re-entrancy first, and by *lineage* rather than by timing -- a shared flag cannot tell
        // "the provider called us back" from "another caller arrived meanwhile". See PlacementScope.
        if (PlacementScope.isPlacing(toolName)) return undefined;

        const inFlight = this.placementInFlight.get(toolName);
        if (inFlight !== undefined) return inFlight;

        const contract = globalContractRegistry.get(toolName);
        const attempt = PlacementScope.run(toolName, async (): Promise<string | undefined> => {
            try {
                const placedOn = await this.placement?.place(toolName, contract);
                if (placedOn === undefined) {
                    this.logger.debug(`[ServiceBroker] placement declined "${toolName}"`);
                } else {
                    this.logger.info(`[ServiceBroker] placed "${toolName}" on ${placedOn}`);
                }
                return placedOn;
            } catch (err) {
                // A failed placement is not a different error than an unplaceable call: the caller
                // still gets "nobody serves this", which is true. Logged rather than thrown so the
                // real cause isn't lost behind it.
                this.logger.error(`[ServiceBroker] placement failed for "${toolName}"`, err);
                return undefined;
            }
        });

        this.placementInFlight.set(toolName, attempt);
        try {
            return await attempt;
        } finally {
            this.placementInFlight.delete(toolName);
        }
    }

    /** Every standalone contract currently mounted here, by tool key. */
    public listContracts(): ToolContract<z.ZodTypeAny, z.ZodTypeAny>[] {
        return Array.from(this.standaloneContracts.values());
    }

    /**
     * Mounts a whole CRUD collection -- every action `defineCrud` generated, in one call. Each is
     * wired like any other contract, including a deliberately-unreachable dispatch:
     * `DatabaseMiddleware` intercepts every CRUD call before it ever reaches a handler, so a
     * handler that actually *runs* means the middleware isn't installed, and saying so loudly beats
     * returning nothing quietly.
     *
     * `hooks` is a shorthand for calling `registerCrudHook` per action.
     */
    public registerCrud(
        crud: AnyCrudContracts,
        options?: {
            hooks?: Partial<Record<string, { before?: CrudHook; after?: CrudHook }>>;
            /** Route this collection to a Database other than the broker-wide default. */
            database?: Database;
        },
    ): void {
        const keys = ['create', 'find', 'findOne', 'get', 'update', 'delete', 'count', 'replace', 'resolve', 'createMany'] as const;
        for (const key of keys) {
            const contract = crud[key];
            if (contract && typeof contract === 'object' && 'domain' in contract && 'action' in contract) {
                const tool = contract as ToolContract<z.ZodTypeAny, z.ZodTypeAny>;
                this.registerContract(tool, async () => {
                    throw new Error(`Engine Error: CRUD action "${tool.action}" for domain "${tool.domain}" was not intercepted.`);
                }, options?.database !== undefined ? { database: options.database } : undefined);
            }
        }

        for (const [action, hook] of Object.entries(options?.hooks ?? {})) {
            if (hook) this.registerCrudHook(crud.domain, action, hook);
        }
    }

    /**
     * Mounts a whole time-series collection, the counterpart to `registerCrud`.
     *
     * Every action gets the same deliberately-unreachable handler: `DatabaseMiddleware` intercepts
     * a time-series call before it ever reaches one, so a handler that actually *runs* means the
     * middleware isn't installed, and saying so loudly beats returning nothing quietly.
     */
    public registerTimeSeries(contracts: AnyTimeSeriesContracts, options?: { database?: Database }): void {
        const keys = ['insert', 'query', 'aggregate', 'latest'] as const;
        for (const key of keys) {
            const contract = contracts[key];
            if (contract && typeof contract === 'object' && 'domain' in contract && 'action' in contract) {
                const tool = contract as ToolContract<z.ZodTypeAny, z.ZodTypeAny>;
                this.registerContract(tool, async () => {
                    throw new Error(`Engine Error: Time Series action "${tool.action}" for domain "${tool.domain}" was not intercepted.`);
                }, options?.database !== undefined ? { database: options.database } : undefined);
            }
        }
    }

    /**
     * Registers the before/after pair for one CRUD action. `CrudExecutor` resolves them through
     * `getCrudHooks` below. A contract's own `hooks` (see `defineCrud`) lands here too, wired by
     * `registerContract` wherever the contract mounts -- so there is no separate registration step
     * anyone can forget, and no second place a hook can hide.
     */
    public registerCrudHook(domain: string, action: string, hooks: { before?: CrudHook; after?: CrudHook }): void {
        const key = `${domain}.${action}`;
        this.standaloneCrudHooks.set(key, hooks);
        const owner = this.currentOwner();
        if (owner !== undefined) this.recordOwned(owner, { kind: 'crudHook', key, hooks });
    }

    public unregisterCrudHook(domain: string, action: string): void {
        this.standaloneCrudHooks.delete(`${domain}.${action}`);
    }

    /**
     * Runs `fn` with every registration it makes recorded under `owner` -- contracts (and so every
     * CRUD collection, which mounts as contracts), CRUD hooks, event handlers -- including ones made
     * after an `await`, because the owner follows async lineage (AsyncLocalStorage), not a flag.
     *
     * The reason it exists: a part loaded through `register(broker)` told nobody what it mounted, so
     * unloading it could not take anything back. Deploying is re-pinning a part and reloading it in
     * place, so the old module's handlers stayed subscribed beside the new module's, and every event
     * ran both.
     */
    public withOwner<T>(owner: string, fn: () => T): T {
        if (ServiceBroker.ownerStorage !== undefined) {
            return ServiceBroker.ownerStorage.run(owner, fn);
        }
        const previous = this.ownerFallback;
        this.ownerFallback = owner;
        try {
            return fn();
        } finally {
            this.ownerFallback = previous;
        }
    }

    /**
     * Reverses everything `owner` registered, newest first. Each piece is removed only while it is
     * still the one `owner` put there: a contract since replaced by another owner, or a hook since
     * overwritten, is left alone.
     */
    public unregisterOwner(owner: string): void {
        const registrations = this.ownedRegistrations.get(owner);
        if (registrations === undefined) return;
        this.ownedRegistrations.delete(owner);

        for (const registration of [...registrations].reverse()) {
            switch (registration.kind) {
                case 'contract':
                    if (this.contractOwners.get(registration.key) === owner && this.standaloneContracts.has(registration.key)) {
                        this.unregisterContract(registration.key);
                    }
                    break;
                case 'crudHook':
                    if (this.standaloneCrudHooks.get(registration.key) === registration.hooks) {
                        this.standaloneCrudHooks.delete(registration.key);
                    }
                    break;
                case 'eventHandler':
                    this.eventHandlers.get(registration.id)?.unregister();
                    break;
            }
        }
        this.logger.info(`[ServiceBroker] Unregistered everything owned by ${owner} (${registrations.length} registrations)`);
    }

    private currentOwner(): string | undefined {
        return ServiceBroker.ownerStorage?.getStore() ?? this.ownerFallback;
    }

    private recordOwned(owner: string, registration: OwnedRegistration): void {
        const list = this.ownedRegistrations.get(owner);
        if (list === undefined) this.ownedRegistrations.set(owner, [registration]);
        else list.push(registration);
    }

    /**
     * Mounts every contract a domain declares, wiring each to the handler its own `filePath` points
     * at -- the replacement for a hand-written `register(broker)` listing them one by one.
     *
     * That listing was the old `ServiceModule` constructor with different syntax: it reconstructed,
     * by hand, a contract-to-handler mapping the contracts already carry. Here nothing is enumerated.
     * The contracts come from `globalContractRegistry` (populated at import time by
     * `defineContract`), and `handlers` is a lookup keyed by tool key, which callers generate from
     * those same declarations rather than writing out. A precompiled bundle has no separate files
     * to `import(filePath)` at runtime, so resolution is the caller's to supply; what does not vary
     * -- which contracts belong to the domain, what a CRUD action needs, when a long-running
     * contract starts -- lives here, once.
     *
     * Three kinds of contract, handled by what each declares rather than by who registered it:
     *
     * - **CRUD/time-series** (`isCrud`): no handler exists or should. `DatabaseMiddleware`
     *   intercepts these before dispatch, so they mount with the same deliberately-unreachable
     *   handler `registerCrud` gives them.
     * - **`long-running`**: registered, then *called*, because that is what declaring it means. The
     *   handler binds its resource and hands teardown to `ctx.signal`. Callers no longer kick their
     *   own listener at the end of `register`.
     * - **everything else**: resolved through `handlers` and mounted.
     *
     * `interval` contracts need nothing extra here -- `registerContract` already starts their timer.
     */
    public async loadDomain(
        domain: string,
        handlers: ContractHandlerMap = {},
        options?: {
            /**
             * Resolves a contract's handler when `handlers` has no entry for it -- the unbundled
             * case, where `filePath` points at a module that really exists and can just be
             * imported. A bundle is one file with no modules left inside it to import, so it
             * supplies `handlers` instead. Same declaration either way; only the lookup differs,
             * and that is the only thing a caller has to choose.
             */
            resolve?: (contract: ToolContract<z.ZodTypeAny, z.ZodTypeAny>) => Promise<unknown>;
            replace?: boolean;
            /** Route this domain's CRUD/time-series calls to a Database other than the default. */
            database?: Database;
        },
    ): Promise<{ domain: string; contracts: string[] }> {
        // Sub-domains included: a part owns `identity` *and* `identity.user`, `identity.ticket`...
        // The dot matters -- a bare prefix would pull `identity-something` in too.
        const owned = Array.from(globalContractRegistry.entries())
            .map(([, contract]) => contract)
            .filter((c) => c.domain === domain || c.domain.startsWith(`${domain}.`));

        if (owned.length === 0) {
            throw new Error(`[ServiceBroker] loadDomain("${domain}"): no contracts declare this domain. Its contract module has to be imported before loading it -- that import is what registers them.`);
        }

        const longRunning: string[] = [];
        const loaded: string[] = [];

        for (const contract of owned) {
            const toolKeyStr = `${contract.domain}.${contract.action}`;

            if (contract.isCrud === true || contract.isTimeSeries === true) {
                this.registerContract(contract, async () => {
                    throw new Error(`Engine Error: CRUD action "${contract.action}" for domain "${contract.domain}" was not intercepted.`);
                }, { replace: options?.replace, database: options?.database });
                loaded.push(toolKeyStr);
                continue;
            }

            const fromMap = handlers[toolKeyStr];
            if (fromMap === undefined && options?.resolve === undefined) {
                throw new Error(`[ServiceBroker] loadDomain("${domain}"): no handler for "${toolKeyStr}". Its contract declares filePath "${contract.filePath}" -- pass a handler map entry for it, or a \`resolve\` that can load that file.`);
            }

            const handler = fromMap !== undefined ? await fromMap() : await options!.resolve!(contract);
            if (typeof handler !== 'function') {
                throw new Error(`[ServiceBroker] loadDomain("${domain}"): the handler resolved for "${toolKeyStr}" is not a function (got ${typeof handler}). Check what "${contract.filePath}" exports.`);
            }

            this.registerContract(
                contract,
                handler as (params: unknown, ctx: IServiceContext) => Promise<unknown>,
                { replace: options?.replace, database: options?.database },
            );
            loaded.push(toolKeyStr);
            if (contract.concurrency === 'long-running') longRunning.push(toolKeyStr);
        }

        // Last, and only once every contract in the domain is mounted: a listener's first request
        // can arrive before this loop finishes, and it may well call a sibling contract.
        for (const toolKeyStr of longRunning) {
            await this.call(toolKeyStr as keyof IServiceToolRegistry, {} as never, { nodeID: this.nodeID });
        }

        return { domain, contracts: loaded };
    }

    /**
     * Resolves the before/after hooks for one CRUD action -- registered either by
     * `registerCrudHook` or by the contract's own `hooks` (see `defineCrud`), which is wired
     * through the same map at registration time.
     */
    public getCrudHooks(domain: string, action: string): { before?: CrudHook; after?: CrudHook } | undefined {
        return this.standaloneCrudHooks.get(`${domain}.${action}`);
    }

    /**
     * Subscribes one event handler, with the same `IServiceContext` a tool handler receives.
     *
     * Takes a declared handler (`defineEventHandler`) or, the older form, a bare event name --
     * which has no domain to elect a leader by, so it is delivered `'each'`.
     *
     * - `'one'` runs only on the leader for the handler's domain; every other node drops the event
     *   here. No leader known (nothing advertises that domain yet) runs it locally, the same
     *   fallback a `leaderScoped` interval contract has.
     * - `ctx.meta` carries the tenant the event belongs to, read from its payload by its own
     *   definition (`eventScope`), so `ctx.db` and `ctx.call` act for that tenant. Before this a
     *   handler got the packet's meta, which for an event from another node names nobody.
     * - `ctx.signal` belongs to the registration: it aborts when the handler is unsubscribed.
     *
     * Returns the unsubscribe. `unregisterOwner` calls it too, for handlers registered in a
     * `withOwner` scope.
     */
    public registerEventHandler<K extends keyof EventRegistry>(
        definition: EventHandlerDefinition<K> | K,
        handler: (payload: EventRegistry[K], ctx: IServiceContext) => void | Promise<void>,
    ): () => void {
        const declared = typeof definition === 'object' ? definition : undefined;
        const name: string = typeof definition === 'object' ? definition.event : definition;
        const id = randomUUID();
        const lifetime = new AbortController();

        const listener = (data: unknown, packet?: IMeshPacket) => {
            if (declared?.delivery === 'one') {
                const leader = this.registry?.leaderFor(declared.domain);
                if (leader !== undefined && leader.nodeID !== this.nodeID) return;
            }
            const ctx = this.makeEventContext(name, data, packet, lifetime.signal);
            // The payload arrives untyped off the emitter (and possibly off the network); its type is
            // the generated EventRegistry entry for this name, which is what the handler declares.
            void Promise.resolve()
                .then(() => handler(data as EventRegistry[K], ctx))
                .catch((err: unknown) => {
                    this.logger.error(`[ServiceBroker] Error in event handler for ${name}:`, err);
                });
        };

        // localEvents, the same emitter registerModule subscribes module handlers on -- not the
        // broker's own public `on`, whose key type is the generated EventRegistry.
        this.localEvents.on(name, listener);

        const unregister = (): void => {
            if (!this.eventHandlers.delete(id)) return;
            this.localEvents.off(name, listener);
            lifetime.abort();
        };
        this.eventHandlers.set(id, { unregister });

        const owner = this.currentOwner();
        if (owner !== undefined) this.recordOwned(owner, { kind: 'eventHandler', id });
        return unregister;
    }

    public async call<K extends keyof IServiceToolRegistry>(
        tool: K,
        params: IServiceToolRegistry[K]['params'],
        options?: ICallOptions<IMeshMeta>
    ): Promise<IServiceToolRegistry[K]['returns']> {
        return this.internalCall(tool as string, params as Record<string, unknown>, options) as Promise<IServiceToolRegistry[K]['returns']>;
    }

    /**
     * The other half of Registry.leaderFor: that method only answers "who should handle domain" --
     * this is what actually gets a call there. `options.nodeID` already exists on `call()` (used,
     * before this, only for the framework's own remote-dispatch bookkeeping) and already means
     * exactly "run this on that specific node, not wherever the load balancer would otherwise
     * pick" -- internalCall's own routing only consults the balancer when `options.nodeID` is
     * unset. So this needed no new dispatch mechanism, only naming the existing one for this use:
     * resolve the leader, force the call there.
     *
     * This is what makes a claim (serve.hold, serve.queue, an infer.provider acquire) safe under
     * real multi-node concurrency without assuming anything about the storage layer's own
     * atomicity -- the claim only ever executes on one physical process at a time (whichever one
     * leaderFor currently names), which is safe by construction (one JS heap, one event loop), not
     * by luck about what database happens to be configured underneath it.
     */
    public async callOnLeader<K extends keyof IServiceToolRegistry>(
        domain: string,
        tool: K,
        params: IServiceToolRegistry[K]['params'],
        options?: ICallOptions<IMeshMeta>
    ): Promise<IServiceToolRegistry[K]['returns']> {
        const leader = this.registry?.leaderFor(domain);
        if (!leader) {
            throw new MeshError({
                message: `No node currently runs domain "${domain}".`,
                code: 'UNAVAILABLE',
                status: 503,
            });
        }
        return this.call(tool, params, { ...options, nodeID: leader.nodeID });
    }

    /**
     * callOnLeader's other half. Pinning an operation to one node answers "which process may run
     * this," not "what happens when two callers reach that same process for the same key at
     * (almost) the same moment" -- two overlapping `await`s on that one process can still
     * interleave a read and a write from different callers, which is exactly the shape of race
     * `callOnLeader` alone doesn't close. This closes it: a per-process, per-key lock with a real
     * TTL and a fencing token, not a database lock and not an unbounded wait.
     *
     * **Why a TTL is mandatory, not optional.** A contract's own timeout can fire before code
     * holding a lock finishes -- and a timed-out call doesn't actually stop running (JS has no
     * real cancellation for a plain Promise; a timeout only stops *waiting* for it). Without a
     * hard maximum lifetime, a lock behind a timed-out or crashed holder would never free, and
     * everyone queued behind that key waits forever. `MAX_LOCK_TTL_MS` refuses a caller's request
     * to hold one longer than that outright, rather than silently doing something other than what
     * was asked.
     *
     * **Why acquire returns a token, and release requires it back.** A lock that expired via TTL
     * can already have a *different*, legitimate holder by the time the original one gets around
     * to calling release -- without a token, that late release would tear down the new holder's
     * lock, not its own. `release` only actually releases when the token still matches the
     * current holder; otherwise it's a safe no-op, because whatever it thought it held, it
     * doesn't anymore.
     *
     * **What this does not do:** a TTL bounds how long the *queue* waits, not how long the
     * original holder's own code keeps running in the background after it expires -- there is no
     * way to force that in plain JS. This is why code inside `withLock` has to be held to the same
     * discipline as an interrupt handler: fast, and nothing in it that can hang. The TTL is a
     * safety net for a bug or a crash, not permission to do slow work while holding the lock.
     *
     * Deliberately not shared across nodes and not persisted -- a process restart clears every
     * lock, which is correct: nothing was actually still "held" once the process holding it is
     * gone.
     */
    private locks = new Map<string, { token: string; expiresAt: number }>();

    private static readonly DEFAULT_LOCK_TTL_MS = 10_000;
    private static readonly MAX_LOCK_TTL_MS = 30_000;
    private static readonly DEFAULT_LOCK_WAIT_MS = 5_000;
    private static readonly LOCK_POLL_INTERVAL_MS = 20;

    /**
     * Claims `key`, waiting up to `waitMs` (default 5s) for it to free up if someone else
     * currently holds it. Throws if it's still held once `waitMs` elapses -- "throws if you don't
     * get it in time," not an unbounded wait. `ttlMs` (default 10s, hard-capped at 30s -- a lock
     * is not a place to hold state for minutes) is how long *this* acquisition is allowed to last
     * before it's treated as abandoned and made claimable again, released or not.
     */
    public async acquire(key: string, options?: { ttlMs?: number; waitMs?: number }): Promise<{ token: string }> {
        const ttlMs = options?.ttlMs ?? ServiceBroker.DEFAULT_LOCK_TTL_MS;
        if (ttlMs > ServiceBroker.MAX_LOCK_TTL_MS) {
            throw new MeshError({
                message: `Lock ttlMs ${ttlMs} exceeds the maximum of ${ServiceBroker.MAX_LOCK_TTL_MS}ms.`,
                code: 'BAD_REQUEST',
                status: 400,
            });
        }
        const waitMs = options?.waitMs ?? ServiceBroker.DEFAULT_LOCK_WAIT_MS;
        const deadline = Date.now() + waitMs;

        for (;;) {
            const now = Date.now();
            const existing = this.locks.get(key);
            if (existing === undefined || existing.expiresAt <= now) {
                const token = randomUUID();
                this.locks.set(key, { token, expiresAt: now + ttlMs });
                return { token };
            }
            if (now >= deadline) {
                throw new MeshError({
                    message: `Could not acquire lock "${key}" within ${waitMs}ms.`,
                    code: 'LOCK_TIMEOUT',
                    status: 503,
                });
            }
            await new Promise((resolve) => {
                setTimeout(resolve, Math.min(ServiceBroker.LOCK_POLL_INTERVAL_MS, deadline - now));
            });
        }
    }

    /** A no-op if `token` isn't the current holder's -- see the class doc above for why that has
     *  to be true rather than releasing unconditionally by key. */
    public release(key: string, token: string): void {
        const existing = this.locks.get(key);
        if (existing !== undefined && existing.token === token) {
            this.locks.delete(key);
        }
    }

    /**
     * The version almost everything should use: `acquire`, run `fn`, `release` -- guaranteed by
     * `finally`, not by the caller remembering to. A bare `acquire`/`release` pair leaks its lock
     * for the rest of that key's TTL the moment any code path between them forgets to call
     * `release` (an early return, a rethrow past it); `withLock` cannot do that by construction.
     */
    public async withLock<T>(key: string, fn: () => Promise<T>, options?: { ttlMs?: number; waitMs?: number }): Promise<T> {
        const { token } = await this.acquire(key, options);
        try {
            return await fn();
        } finally {
            this.release(key, token);
        }
    }

    public emit<K extends keyof EventRegistry>(event: K, payload: EventRegistry[K], options?: { skipNetwork?: boolean }): void {
        const packet: IMeshPacket = {
            id: randomUUID(),
            topic: event as string,
            data: payload,
            senderNodeID: this.nodeID,
            type: 'EVENT',
            timestamp: Date.now(),
            version: 1,
            priority: 1,
            meta: { local: true }
        };

        this._triggerLocal(event as string, payload, packet);

        if (this.network && !options?.skipNetwork) {
            this.network.publish(event as string, payload);
        }
    }

    private async internalCall(
        toolName: string,
        params: Record<string, unknown>,
        options?: ICallOptions<IMeshMeta>,
        parentCtx?: IContext<Record<string, unknown>, Record<string, unknown>>
    ): Promise<unknown> {
        const schema = MeshToolSchemaRegistry.get(toolName);
        if (schema?.params && params !== undefined) {
            try {
                if (typeof (schema.params as z.ZodTypeAny).parse === 'function') {
                    params = (schema.params as z.ZodTypeAny).parse(params) as Record<string, unknown>;
                }
            } catch (error) {
                // A caller passing params the contract rejects is a *client* error, not a server
                // fault. Throwing a plain `Error` here gave it no `status`, so anything mapping
                // mesh errors to a transport (an HTTP gateway, the CLI) had to report it as a 500
                // -- the wrong status, with a message unsafe to forward because it embedded the
                // raw thrown value. `ClientError` already exists and already carries status 400.
                throw new ClientError(
                    `Invalid params for tool ${toolName}: ${formatZodIssues(error)}`,
                    'INVALID_PARAMS'
                );
            }
        } else if (params === undefined) {
            params = {};
        }

        let targetNodeID = options?.nodeID;

        if (!targetNodeID && !this.localTools.has(toolName)) {
            if (this.registry) {
                const endpoint = this.registry.selectNode(toolName, {
                    toolName: toolName,
                    params
                });
                if (endpoint) {
                    targetNodeID = endpoint.nodeID;
                }
            }

            // Nobody serves this. Before failing, give the placement layer a chance to load it
            // somewhere -- this is what makes an `on-demand` contract genuinely on-demand rather
            // than something an operator has to have started in advance. No provider configured
            // (the default) means the call fails exactly as it always did.
            if (targetNodeID === undefined && this.placement !== undefined) {
                const placedOn = await this.ensurePlaced(toolName);
                if (placedOn !== undefined && placedOn !== this.nodeID) {
                    targetNodeID = placedOn;
                }
                // Placed locally: leave targetNodeID undefined so it dispatches through
                // localTools, which `place` has just populated.
            }
        }

        const activeCtx = parentCtx || this.getContext();
        const traceId = activeCtx?.traceId || randomUUID();
        const parentId = activeCtx?.spanId;
        const spanId = randomUUID();

        const timeout = options?.timeout !== undefined ? options.timeout : schema?.timeout;

        const ctx: IContext<Record<string, unknown>, IMeshMeta> = {
            id: randomUUID(),
            correlationID: activeCtx?.correlationID || randomUUID(),
            toolName,
            params: params,
            meta: { ...(activeCtx?.meta as IMeshMeta), ...(options?.meta as IMeshMeta), timeout },
            targetNodeID: targetNodeID,
            callerID: activeCtx?.id || null,
            nodeID: this.nodeID,
            traceId,
            spanId,
            parentId,
        };

        const timeoutMs = this.evaluateTimeout(ctx.meta?.timeout as number, schema?.timeout);
        let timer: ReturnType<typeof setTimeout> | undefined;

        const resultPromise = this.handlePipeline(ctx);
        let result: unknown;

        const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => {
                reject(new Error(`[ServiceBroker] RPC Timeout calling ${toolName} locally after ${timeoutMs}ms`));
            }, timeoutMs);
        });

        try {
            result = await Promise.race([resultPromise, timeoutPromise]);
        } finally {
            if (timer) SafeTimer.clearTimeout(timer);
        }

        if (schema?.returns) {
            // A projected read may be missing declared fields; it may never carry undeclared ones.
            // See `applyReturns`.
            const isCrudProjection = Boolean(schema.isCrud && ctx.params && (ctx.params.fields !== undefined));
            return ServiceBroker.applyReturns(schema.returns as z.ZodTypeAny, isCrudProjection, result);
        }
        return result;
    }

    public async handleIncomingRPC(packet: IMeshPacket): Promise<unknown> {
        const meta = (packet.meta as Record<string, unknown>) || {};
        const targetNodeID = (meta.finalDestinationID as string) || packet.targetNodeID;

        const ctx: IContext<Record<string, unknown>, IMeshMeta> = {
            id: packet.id,
            correlationID: (packet.meta?.correlationID as string) || packet.id,
            toolName: packet.topic,
            params: packet.data as Record<string, unknown>,
            meta: meta as IMeshMeta,
            callerID: packet.senderNodeID,
            nodeID: this.nodeID,
            targetNodeID: targetNodeID,
            traceId: (meta.traceId as string) || randomUUID(),
            spanId: (meta.spanId as string) || randomUUID(),
            parentId: meta.parentId as string,
        };

        const schema = MeshToolSchemaRegistry.get(packet.topic);
        const timeoutMs = this.evaluateTimeout(ctx.meta?.timeout as number, schema?.timeout);
        let timer: ReturnType<typeof setTimeout> | undefined;

        const resultPromise = this.handlePipeline(ctx);
        let result: unknown;

        const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => {
                reject(new Error(`[ServiceBroker] RPC Timeout calling ${packet.topic} locally (from network) after ${timeoutMs}ms`));
            }, timeoutMs);
        });

        try {
            result = await Promise.race([resultPromise, timeoutPromise]);
        } finally {
            if (timer) SafeTimer.clearTimeout(timer);
        }

        if (schema?.returns) {
            // A projected read may be missing declared fields; it may never carry undeclared ones.
            // See `applyReturns`.
            const isCrudProjection = Boolean(schema.isCrud && ctx.params && (ctx.params.fields !== undefined));
            return ServiceBroker.applyReturns(schema.returns as z.ZodTypeAny, isCrudProjection, result);
        }
        return result;
    }

    public async handlePipeline(ctx: IContext<Record<string, unknown>, IMeshMeta>): Promise<unknown> {
        return await ContextStack.run(ctx, async () => {
            try {
                const finalHandler = async () => {
                    const isLocal = !ctx.targetNodeID || ctx.targetNodeID === this.nodeID;
                    if (isLocal) {
                        const tool = this.localTools.get(ctx.toolName);
                        if (!tool) {
                            // "Local tool not found" collapses three genuinely different
                            // situations into one unhelpful message -- distinguish them:
                            // (1) this broker has nothing mounted at all (a bare CLI/client
                            //     process, or a node that never finished booting);
                            // (2) the contract is known (schema registered) but no live
                            //     node currently advertises it -- a reachability/bootstrap
                            //     problem, not a naming problem; (3) genuinely unknown name,
                            //     possibly a typo -- surface same-domain siblings if any.
                            const knownSchema = MeshToolSchemaRegistry.get(ctx.toolName);
                            const registeredTools = Array.from(this.localTools.keys());
                            const domain = ctx.toolName.split('.')[0];
                            const sameDomainTools = registeredTools.filter((t) => t.startsWith(`${domain}.`));

                            // A CLI client legitimately has zero local tools and reaches
                            // everything remotely, so `registeredTools.length === 0` cannot be
                            // the first test -- it is always true there, and it swallowed the
                            // two informative cases below. Ask the registry what the *mesh*
                            // knows before blaming the local process.
                            const meshNodes = this.registry ? this.registry.getNodes() : [];
                            const remotePeers = meshNodes.filter((n) => n.nodeID !== this.nodeID);

                            let reason: string;
                            if (registeredTools.length === 0 && remotePeers.length === 0) {
                                reason = 'this broker has no local tools mounted at all and no remote nodes are connected -- likely a bare CLI/client process with no services attached (e.g. `mesh start --services <dir>` was never run here), or it never finished booting';
                            } else if (registeredTools.length === 0) {
                                // The informative case for a CLI: connected to a real mesh, but
                                // nothing in it mounts this domain. Name the nodes that *are*
                                // there, so "which role do I need to start?" is answerable.
                                reason = knownSchema
                                    ? `the contract is defined (schema registered), but none of the ${remotePeers.length} connected node(s) [${remotePeers.map((n) => n.nodeID).join(', ')}] advertises it -- the owning service is not running in any role you are connected to, not a problem with this client`
                                    : `no node in this mesh advertises domain "${domain}" -- connected to ${remotePeers.length} node(s) [${remotePeers.map((n) => n.nodeID).join(', ')}], likely a typo or that service isn't started anywhere`;
                            } else if (knownSchema) {
                                reason = 'the contract is defined (schema registered), but no node currently advertising it was reachable -- check whether the owning service is running and connected to this mesh (bootstrap URL correct?), this is a reachability problem, not a naming problem';
                            } else if (sameDomainTools.length > 0) {
                                reason = `not a registered action under domain "${domain}" -- did you mean one of: ${sameDomainTools.join(', ')}?`;
                            } else {
                                reason = `no domain "${domain}" is mounted anywhere on this broker -- likely a typo, or that service isn't started`;
                            }

                            // this.logger.error(`[ServiceBroker] Tool not found: ${ctx.toolName} -- ${reason}`, {
                            //     targetNodeID: ctx.targetNodeID,
                            //     nodeID: this.nodeID,
                            //     registeredToolCount: registeredTools.length,
                            //     ...(sameDomainTools.length > 0 ? { sameDomainTools } : {})
                            // });
                            throw new Error(`[ServiceBroker] Local tool not found: ${ctx.toolName} -- ${reason}`);
                        }

                        let parsedParams = ctx.params;
                        const schema = MeshToolSchemaRegistry.get(ctx.toolName);
                        if (schema?.params) {
                            try {
                                parsedParams = schema.params.parse(ctx.params);
                            } catch (error) {
                                // Same reasoning as internalCall's validation above: a raw ZodError
                                // escaping here carries no status either, so a remote-dispatched
                                // call's bad params surfaced as a 500 rather than a 400.
                                throw new ClientError(
                                    `Invalid params for tool ${ctx.toolName}: ${formatZodIssues(error)}`,
                                    'INVALID_PARAMS'
                                );
                            }
                        }

                        return await tool.handler({ ...ctx, params: parsedParams } as IContext<Record<string, unknown>, Record<string, unknown>>);
                    } else {
                        return await this.executeRemote(ctx.targetNodeID!, ctx.toolName, ctx.params, ctx.meta as Record<string, unknown>);
                    }
                };

                const isLocalInitially = !ctx.targetNodeID || ctx.targetNodeID === this.nodeID;
                const chain = [...this.globalMiddleware];
                if (isLocalInitially) {
                    chain.push(...this.localMiddleware);
                }

                return await this.executeChain(ctx as IContext<Record<string, unknown>, Record<string, unknown>>, chain, finalHandler);

            } catch (err) {
                ctx.error = err instanceof Error ? err : new Error(String(err));
                throw ctx.error;
            }
        });
    }

    private async executeChain(
        ctx: IContext<Record<string, unknown>, Record<string, unknown>>,
        chain: IMiddleware[],
        finalHandler: () => Promise<unknown>
    ): Promise<unknown> {
        const executeNext = async (index: number): Promise<unknown> => {
            if (index < chain.length) {
                return await chain[index](ctx, () => executeNext(index + 1));
            }
            return await finalHandler();
        };
        return await executeNext(0);
    }

    public async executeRemote(nodeID: string, toolName: string, params: unknown, meta: Record<string, unknown> = {}): Promise<unknown> {
        if (!this.network) throw new Error('[ServiceBroker] Network not initialized');

        // The packet id -- what a response is matched on, and what a receiver's duplicate filter keys
        // on (MeshNetwork drops any non-response packet whose id it saw in the last 10s) -- has to be
        // unique to *this* call. It used to be the caller's correlationID, which is shared by every
        // call in a chain: the first remote call from inside a handler worked, and every later one
        // carried the same id, was dropped at the receiver as a duplicate, and left its caller
        // waiting out the full timeout for a request nobody had seen. The correlationID still
        // travels in meta, where it belongs, so the callee's ctx and traces stay linked to the chain.
        const requestId = randomUUID();
        const correlationID = (meta.correlationID as string) || (meta.id as string) || requestId;

        const currentCtx = this.getContext();
        const tracingMeta = {
            traceId: currentCtx?.traceId,
            spanId: currentCtx?.spanId,
            parentId: currentCtx?.parentId
        };

        const schema = MeshToolSchemaRegistry.get(toolName);
        let remoteTimeout: number | undefined;
        if (!schema && this.registry) {
            const endpoint = this.registry.getNextToolEndpoint(toolName);
            if (endpoint?.tool?.timeout !== undefined) remoteTimeout = endpoint.tool.timeout as number;
        }

        const timeoutMs = this.evaluateTimeout(meta.timeout as number, schema?.timeout, remoteTimeout);

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                this.logger.info('Nodes available at timeout:', this.registry.getNodes().map(n => n.nodeID));
                reject(new Error(`[ServiceBroker] RPC Timeout calling ${toolName} on ${nodeID} after ${timeoutMs}ms`));
            }, timeoutMs);

            this.pendingRequests.set(requestId, {
                resolve,
                reject,
                timeout
            });

            this.network.send(nodeID, toolName, params, {
                id: requestId,
                type: 'REQUEST',
                meta: { ...meta, ...tracingMeta, timeout: timeoutMs, correlationID },
                senderNodeID: this.nodeID,
                topic: toolName
            }).catch(err => {
                SafeTimer.clearTimeout(timeout);
                this.pendingRequests.delete(requestId);
                reject(err instanceof Error ? err : new Error(String(err)));
            });
        });
    }

    public async start(): Promise<void> {
        this.isStarted = true;

        for (const plugin of this.plugins) {
            if (plugin.onStart) await plugin.onStart(this);
        }

        // Interval contracts mounted before the broker started -- the normal case for anything
        // loaded during boot.
        for (const [toolKeyStr, contract] of this.pendingIntervals) {
            this.startIntervalContract(toolKeyStr, contract);
        }
        this.pendingIntervals.clear();
    }

    public async stop(): Promise<void> {
        this.isStarted = false;

        // Stop scheduling before aborting, so no tick starts against a broker that is tearing down.
        for (const timer of this.intervalTimers.values()) SafeTimer.clearInterval(timer);
        this.intervalTimers.clear();
        this.pendingIntervals.clear();

        // Every long-running contract's teardown, and cancellation for whatever is still in flight.
        for (const abort of this.lifetimeAborts.values()) abort.abort();
        this.lifetimeAborts.clear();
        for (const abort of this.inFlightAborts) abort.abort();
        this.inFlightAborts.clear();

        for (const pending of this.pendingRequests.values()) {
            SafeTimer.clearTimeout(pending.timeout);
            pending.reject(new Error('Broker stopped'));
        }
        this.pendingRequests.clear();

        for (const plugin of this.plugins) {
            if (plugin.onStop) await plugin.onStop(this);
        }
    }
}
