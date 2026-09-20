import { z } from 'zod';
import { IServiceBroker } from '../interfaces/IServiceBroker.js';
import { Database } from './Database.js';
import { FindOptions, StrictFilterQuery } from './types.js';
import { MeshError } from '../core/MeshError.js';
import { globalCrudRegistry } from '../interfaces/ICrudContract.js';
import type { CrudRepo, IServiceContext } from '../interfaces/IServiceContext.js';

/** Mirrors ServiceBroker's own `CrudHook` -- declared here rather than imported to keep this module
 *  free of a circular dependency back on ServiceBroker. */
type CrudHookFn = (value: unknown, ctx: IServiceContext) => Promise<unknown>;

interface BaseDoc {
    id: string;
    createdAt?: Date;
    updatedAt?: Date;
    [key: string]: unknown;
}

function isRecord(obj: unknown): obj is Record<string, unknown> {
    return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
}

/**
 * `defineCrud`'s `hidden` field, enforced. Applied to every CRUD result (find/get/create/update/...)
 * and every event payload this executor emits -- the one place, so a collection's hidden fields stay
 * hidden regardless of which action, or which caller (`ctx.call()` or `ctx.db()`), produced them. Not
 * a `.parse()` against `publicOutputSchema`: that would re-validate the whole document on every read,
 * and a plain delete of known field names is both cheaper and cannot itself reject an otherwise-valid
 * document.
 */
function stripHidden(domain: string, value: unknown): unknown {
    const hidden = globalCrudRegistry.get(domain)?.hidden;
    if (!hidden || hidden.length === 0) return value;
    const omit = (doc: Record<string, unknown>): Record<string, unknown> => {
        const copy = { ...doc };
        for (const field of hidden) delete copy[field];
        return copy;
    };
    if (Array.isArray(value)) return value.map((item) => (isRecord(item) ? omit(item) : item));
    return isRecord(value) ? omit(value) : value;
}

function toSnakeCase(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

function resolveCallerScope(meta: Record<string, unknown> | undefined, scopeField: string): string | undefined {
    if (!meta || typeof meta !== 'object') return undefined;

    const snakeField = toSnakeCase(scopeField);
    const user = isRecord(meta.user) ? meta.user : undefined;

    if (user) {
        const userScopeVal = user[scopeField];
        if (typeof userScopeVal === 'string' && userScopeVal.length > 0) return userScopeVal;
        const userSnakeVal = user[snakeField];
        if (typeof userSnakeVal === 'string' && userSnakeVal.length > 0) return userSnakeVal;
        if (scopeField.toLowerCase() === 'userid' && typeof user.id === 'string' && user.id.length > 0) return user.id;
    }

    const metaScopeVal = meta[scopeField];
    if (typeof metaScopeVal === 'string' && metaScopeVal.length > 0) return metaScopeVal;
    const metaSnakeVal = meta[snakeField];
    if (typeof metaSnakeVal === 'string' && metaSnakeVal.length > 0) return metaSnakeVal;

    return undefined;
}

/**
 * emitNamed: additive, backward-compatible companion to the generic
 * `data.created`/`data.updated`/`data.deleted` events every CRUD write already
 * fires. Emits `<domain>.<created|updated|deleted>` with the same payload
 * shape minus the now-redundant `domain` field, so a subscriber can mount a
 * strongly-typed handler for one specific domain's writes instead of
 * subscribing to the whole-mesh `data.*` firehose and filtering by domain at
 * runtime. The event name is dynamic (not a static `keyof EventRegistry` --
 * that interface is augmented per-project by `mesh generate`, see
 * GenerateCommand.ts's `generateEvents`), so this is the one place in the
 * framework that deliberately bypasses that compile-time key check; every
 * subscriber-side `mountEventHandler` call still gets full typing from the
 * generated registry entry.
 */
function emitNamed(broker: IServiceBroker, domain: string, suffix: string, payload: Record<string, unknown>): void {
    broker.emit(`${domain}.${suffix}` as never, payload as never);
}

/**
 * CrudExecutor: the one real implementation of "run a generic CRUD action against a domain,
 * correctly" -- scope resolution and injection (`scopedBy`), the actual `repo`/`DomainRepository`
 * call, `hidden`-field stripping, generic + named event emission, and a module's own
 * `beforeCrud`/`afterCrud` hooks. Extracted out of `DatabaseMiddleware.ts` (which is now a thin
 * adapter calling this) so a second, direct caller -- `ctx.db()`, `IServiceContext.ts` -- can reach
 * the exact same guarantees without going through the registry/network dispatch path at all. Two
 * callers, one implementation: the whole point is that they cannot drift apart the way a
 * re-implementation could.
 */
export class CrudExecutor {
    public static async execute(
        deps: { broker: IServiceBroker; db: Database },
        args: { domain: string; action: string; params: Record<string, unknown>; meta: Record<string, unknown> | undefined }
    ): Promise<unknown> {
        const { broker, db } = deps;
        const { domain, action, meta } = args;
        let params = args.params;

        const crudDef = globalCrudRegistry.get(domain);
        const possibleSchema = crudDef?.outputSchema;
        if (!possibleSchema) {
            throw new MeshError({
                code: 'NOT_FOUND',
                status: 500,
                message: `CrudExecutor: no defineCrud registration found for domain "${domain}". ` +
                    `Either "${domain}" never called defineCrud, or this ran before its module was imported.`,
            });
        }

        const schema: z.ZodType<BaseDoc> = possibleSchema as z.ZodType<BaseDoc>;
        const repo = db.repo(schema, domain);

        const scopedBy = crudDef.scopedBy;
        let callerScope: string | undefined;

        if (scopedBy) {
            callerScope = resolveCallerScope(meta, scopedBy);
            if (!callerScope) {
                throw new MeshError({
                    code: 'UNAUTHORIZED',
                    status: 401,
                    message: `Scoped collection "${domain}" requires a resolved "${scopedBy}" scope, but none was provided in call context.`
                });
            }
        }

        // Resolved through the broker rather than reaching for a module directly: hooks can now be
        // registered standalone (`broker.registerCrudHook`, no ServiceModule) as well as by a
        // module, and `getCrudHooks` is the one place that knows which owns a given action.
        const brokerWithHooks = broker as IServiceBroker & {
            getCrudHooks?: (domain: string, action: string) => { before?: CrudHookFn; after?: CrudHookFn } | undefined;
        };
        const hooks = brokerWithHooks.getCrudHooks?.(domain, action);

        // Same shape DatabaseMiddleware has always built for beforeCrud/afterCrud -- `meta` has to be
        // the real caller's meta (see the comment history in DatabaseMiddleware.ts: omitting it here
        // once meant a module's own scoping hook silently saw no caller and returned every row).
        const serviceCtx = {
            broker,
            meta,
            // A CRUD hook is always an on-demand, call-scoped thing, so its signal is too. It is
            // never aborted here (the hook returns or throws long before anything could cancel it);
            // it exists so `ctx.signal` is a real AbortSignal in every context a handler can be
            // handed, rather than being present on some and absent on others.
            signal: new AbortController().signal,
            correlationId: '',
            nodeID: broker.nodeID,
            call: <K extends keyof IServiceToolRegistry>(
                a: K,
                p: IServiceToolRegistry[K]['params'],
                o?: { nodeID?: string; timeout?: number }
            ) => broker.call(a, p, o),
            callOnLeader: <K extends keyof IServiceToolRegistry>(
                leaderDomain: string,
                a: K,
                p: IServiceToolRegistry[K]['params'],
                o?: { timeout?: number }
            ) => broker.callOnLeader(leaderDomain, a, p, o),
            acquire: (key: string, options?: { ttlMs?: number; waitMs?: number }) => broker.acquire(key, options),
            release: (key: string, token: string) => broker.release(key, token),
            withLock: <T>(key: string, fn: () => Promise<T>, options?: { ttlMs?: number; waitMs?: number }): Promise<T> => broker.withLock(key, fn, options),
            emit: <K extends keyof EventRegistry>(
                e: K,
                p: EventRegistry[K],
                o?: { skipNetwork?: boolean }
            ) => broker.emit(e, p, o),
            // Resolved the same way `ServiceBroker.makeCrudRepo` resolves it for an ordinary
            // handler's own `ctx.db()` -- a `beforeCrud`/`afterCrud` hook reaching into some *other*
            // domain gets that domain's own mount-database override, not this call's `db`, which may
            // belong to a different mount entirely.
            db: <D extends keyof IServiceCollectionRegistry & string>(otherDomain: D, overrideMeta?: Record<string, unknown>) =>
                CrudExecutor.makeCrudRepo(broker, otherDomain, overrideMeta ? { ...meta, ...overrideMeta } : meta),
            logger: broker.logger
        };

        if (hooks?.before) {
            const beforeResult = await hooks.before(params, serviceCtx as never);
            if (isRecord(beforeResult)) {
                params = beforeResult;
            }
        }

        let result: unknown;

        try {
            switch (action) {
                case 'find': {
                    const query: Record<string, unknown> = isRecord(params.query) ? { ...params.query } : {};
                    if (scopedBy && callerScope) {
                        query[scopedBy] = callerScope;
                    }
                    const options: FindOptions<BaseDoc> = {
                        query: query as StrictFilterQuery<BaseDoc>,
                        limit: typeof params.limit === 'number' ? params.limit : 100,
                        offset: typeof params.offset === 'number' ? params.offset : undefined,
                    };
                    if (typeof params.sort === 'string' || Array.isArray(params.sort) || isRecord(params.sort)) {
                        options.sort = params.sort as FindOptions<BaseDoc>['sort'];
                    }
                    if (typeof params.fields === 'string' || Array.isArray(params.fields)) {
                        options.fields = params.fields;
                    }
                    if (typeof params.search === 'string') {
                        options.search = params.search;
                    }
                    if (typeof params.searchFields === 'string' || Array.isArray(params.searchFields)) {
                        options.searchFields = params.searchFields;
                    }
                    result = await repo.find(options);
                    break;
                }
                case 'find_one': {
                    const query: Record<string, unknown> = isRecord(params.query) ? { ...params.query } : {};
                    if (scopedBy && callerScope) {
                        query[scopedBy] = callerScope;
                    }
                    let sort: FindOptions<BaseDoc>['sort'] = undefined;
                    if (typeof params.sort === 'string' || Array.isArray(params.sort) || isRecord(params.sort)) {
                        sort = params.sort as FindOptions<BaseDoc>['sort'];
                    }
                    const offset = typeof params.offset === 'number' ? params.offset : undefined;
                    const fields = typeof params.fields === 'string' || Array.isArray(params.fields) ? params.fields : undefined;

                    result = await repo.findOne(query as StrictFilterQuery<BaseDoc>, { sort, offset, fields });
                    break;
                }
                case 'count': {
                    const query: Record<string, unknown> = isRecord(params.query) ? { ...params.query } : {};
                    if (scopedBy && callerScope) {
                        query[scopedBy] = callerScope;
                    }
                    result = await repo.count(query as StrictFilterQuery<BaseDoc>);
                    break;
                }
                case 'get': {
                    const id = typeof params.id === 'string' ? params.id : '';
                    const scopeQuery = scopedBy && callerScope ? ({ [scopedBy]: callerScope } as StrictFilterQuery<BaseDoc>) : undefined;
                    const doc = await repo.get(id, scopeQuery);
                    if (!doc) {
                        throw new MeshError({ code: 'NOT_FOUND', status: 404, message: `${domain} not found: ${id}` });
                    }
                    result = doc;
                    break;
                }
                case 'create': {
                    const createData: Record<string, unknown> = { ...params };
                    if (scopedBy && callerScope) {
                        createData[scopedBy] = callerScope;
                    }
                    const createRes = await repo.create(createData as Omit<BaseDoc, 'id' | 'createdAt' | 'updatedAt'> & Partial<BaseDoc>);
                    const strippedCreateRes = stripHidden(domain, createRes as Record<string, unknown>) as Record<string, unknown>;
                    broker.emit('data.created', { domain, id: createRes.id, item: strippedCreateRes });
                    emitNamed(broker, domain, 'created', strippedCreateRes);
                    result = createRes;
                    break;
                }
                case 'create_many': {
                    const arr = Array.isArray(params) ? params : [params];
                    const created: BaseDoc[] = [];
                    for (const item of arr) {
                        if (isRecord(item)) {
                            const createData: Record<string, unknown> = { ...item };
                            if (scopedBy && callerScope) {
                                createData[scopedBy] = callerScope;
                            }
                            const res = await repo.create(createData as Omit<BaseDoc, 'id' | 'createdAt' | 'updatedAt'> & Partial<BaseDoc>);
                            created.push(res);
                            const strippedRes = stripHidden(domain, res as Record<string, unknown>) as Record<string, unknown>;
                            broker.emit('data.created', { domain, id: res.id, item: strippedRes });
                            emitNamed(broker, domain, 'created', strippedRes);
                        }
                    }
                    result = created;
                    break;
                }
                case 'update': {
                    const id = typeof params.id === 'string' ? params.id : '';
                    const updatePatch: Record<string, unknown> = { ...params };
                    if (scopedBy) {
                        delete updatePatch[scopedBy];
                    }
                    const scopeQuery = scopedBy && callerScope ? ({ [scopedBy]: callerScope } as StrictFilterQuery<BaseDoc>) : undefined;
                    const updateRes = await repo.update(id, updatePatch as Partial<BaseDoc>, scopeQuery);
                    if (!updateRes) {
                        throw new MeshError({ code: 'NOT_FOUND', status: 404, message: `${domain} not found: ${id}` });
                    }
                    const strippedUpdateRes = stripHidden(domain, updateRes as Record<string, unknown>) as Record<string, unknown>;
                    broker.emit('data.updated', {
                        domain,
                        id: updateRes.id,
                        patch: params as Record<string, unknown>,
                        item: strippedUpdateRes
                    });
                    emitNamed(broker, domain, 'updated', {
                        id: updateRes.id,
                        patch: params as Record<string, unknown>,
                        item: strippedUpdateRes
                    });
                    result = updateRes;
                    break;
                }
                case 'replace': {
                    const id = typeof params.id === 'string' ? params.id : '';
                    const replaceData: Record<string, unknown> = { ...params };
                    if (scopedBy && callerScope) {
                        replaceData[scopedBy] = callerScope;
                    }
                    const scopeQuery = scopedBy && callerScope ? ({ [scopedBy]: callerScope } as StrictFilterQuery<BaseDoc>) : undefined;
                    const replaceRes = await repo.replace(id, replaceData as Omit<BaseDoc, 'id' | 'createdAt' | 'updatedAt'> & Partial<BaseDoc>, scopeQuery);
                    if (!replaceRes) {
                        throw new MeshError({ code: 'NOT_FOUND', status: 404, message: `${domain} not found: ${id}` });
                    }
                    const strippedReplaceRes = stripHidden(domain, replaceRes as Record<string, unknown>) as Record<string, unknown>;
                    broker.emit('data.updated', {
                        domain,
                        id: replaceRes.id,
                        patch: params as Record<string, unknown>,
                        item: strippedReplaceRes
                    });
                    emitNamed(broker, domain, 'updated', {
                        id: replaceRes.id,
                        patch: params as Record<string, unknown>,
                        item: strippedReplaceRes
                    });
                    result = replaceRes;
                    break;
                }
                case 'delete': {
                    const id = typeof params.id === 'string' ? params.id : '';
                    const scopeQuery = scopedBy && callerScope ? ({ [scopedBy]: callerScope } as StrictFilterQuery<BaseDoc>) : undefined;
                    const success = await repo.delete(id, scopeQuery);
                    result = { success };
                    if (success) {
                        broker.emit('data.deleted', { domain, id });
                        emitNamed(broker, domain, 'deleted', { id });
                    }
                    break;
                }
                case 'resolve': {
                    // Same lookup as 'get', by the same ID -- never throws NotFound.
                    const id = typeof params.id === 'string' ? params.id : '';
                    const scopeQuery = scopedBy && callerScope ? ({ [scopedBy]: callerScope } as StrictFilterQuery<BaseDoc>) : undefined;
                    result = await repo.get(id, scopeQuery);
                    break;
                }
                default:
                    throw new MeshError({ code: 'BAD_REQUEST', status: 400, message: `CrudExecutor: unknown CRUD action "${action}" for domain "${domain}".` });
            }

            if (hooks?.after) {
                result = await hooks.after(result, serviceCtx as never);
            }

            return stripHidden(domain, result);
        } catch (error) {
            broker.logger.error(`[CrudExecutor] Failed to execute CRUD action ${action} for domain ${domain}`, { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Backs `ctx.db(domain)` -- the one real implementation, shared by `ServiceBroker`'s two
     * `serviceCtx` build sites and by this executor's own `beforeCrud`/`afterCrud` `serviceCtx`
     * (a hook reaching into some *other* domain). `meta` is closed over at the point `db()` is
     * called, never re-suppliable per method call -- the same discipline every other capability on
     * `IServiceContext` already holds.
     *
     * `getDatabaseForTool` uses a representative `${domain}.get` key -- an instance-database
     * override (`registerModule`'s `options.database`) is per-*mount*, not per-action, so any of the
     * domain's own action keys resolves the identical override `ctx.call()` would have used.
     */
    public static makeCrudRepo<D extends keyof IServiceCollectionRegistry & string>(
        broker: IServiceBroker,
        domain: D,
        meta: Record<string, unknown> | undefined
    ): CrudRepo<D> {
        const effectiveDb = broker.getDatabaseForTool(`${domain}.get`) ?? broker.getProvider<Database>('database');
        const exec = (action: string, params: Record<string, unknown>): Promise<unknown> =>
            CrudExecutor.execute({ broker, db: effectiveDb }, { domain, action, params, meta });

        return {
            find: (p) => exec('find', p as Record<string, unknown>) as ReturnType<CrudRepo<D>['find']>,
            findOne: (p) => exec('find_one', p as Record<string, unknown>) as ReturnType<CrudRepo<D>['findOne']>,
            get: (p) => exec('get', p as Record<string, unknown>) as ReturnType<CrudRepo<D>['get']>,
            resolve: (p) => exec('resolve', p as Record<string, unknown>) as ReturnType<CrudRepo<D>['resolve']>,
            create: (p) => exec('create', p as Record<string, unknown>) as ReturnType<CrudRepo<D>['create']>,
            update: (p) => exec('update', p as Record<string, unknown>) as ReturnType<CrudRepo<D>['update']>,
            replace: (p) => exec('replace', p as Record<string, unknown>) as ReturnType<CrudRepo<D>['replace']>,
            delete: (p) => exec('delete', p as Record<string, unknown>) as ReturnType<CrudRepo<D>['delete']>,
            count: (p) => exec('count', p as Record<string, unknown>) as ReturnType<CrudRepo<D>['count']>,
        };
    }
}
