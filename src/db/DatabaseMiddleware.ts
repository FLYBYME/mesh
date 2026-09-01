import { IMiddleware } from '../interfaces/IInterceptor.js';
import { IContext } from '../interfaces/IContext.js';
import { IServiceBroker } from '../interfaces/IServiceBroker.js';
import { MeshToolSchemaRegistry } from '../core/ServiceBroker.js';
import { Database } from './Database.js';
import { FindOptions, StrictFilterQuery } from './types.js';
import { z } from 'zod';
import { IServiceModule } from '../interfaces/IServiceModule.js';
import { MeshError } from '../core/MeshError.js';
interface BaseDoc {
    id: string;
    createdAt?: Date;
    updatedAt?: Date;
    [key: string]: unknown;
}

interface TSPoint {
    timestamp: Date;
    tags: Record<string, string>;
    [key: string]: unknown;
}

function isRecord(obj: unknown): obj is Record<string, unknown> {
    return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
}

function isStringArray(obj: unknown): obj is string[] {
    return Array.isArray(obj) && obj.every(i => typeof i === 'string');
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

export function createDatabaseMiddleware(broker: IServiceBroker, db: Database): IMiddleware {
    return async (ctx: IContext<Record<string, unknown>, Record<string, unknown>>, next) => {
        const toolKey = ctx.toolName;
        const schemaReg = MeshToolSchemaRegistry.get(toolKey);

        if (!schemaReg?.isCrud && !schemaReg?.isTimeSeries) {
            return await next();
        }

        const domain = schemaReg.domain;
        if (!domain) {
            return await next();
        }

        // Split on the *last* dot, not `domain.length + 1`: `domain` here is the contract's real
        // domain (from MeshToolSchemaRegistry), but `toolKey` is the *effective* key a mount-key
        // alias may have prefixed (e.g. `test:widget.create` for schemaReg.domain === 'widget') --
        // `domain` is no longer guaranteed to be an exact, immediate prefix of `toolKey` once
        // registerModule's `key` option is in play. An action name never contains a literal '.'
        // (dots are reserved as the domain/action separator everywhere in this framework), so the
        // last dot is always the real split point, aliased or not.
        const action = toolKey.substring(toolKey.lastIndexOf('.') + 1);
        // A mount-keyed instance registered with its own `database` (registerModule's
        // `options.database`) routes its CRUD/time-series calls there instead of this
        // middleware's shared default -- e.g. an isolated test database for a test-mounted
        // instance, never touching the same collections as the real one. Falls back to the
        // shared `db` for every mount that didn't ask for an override (unchanged behavior).
        const effectiveDb = broker.getDatabaseForTool(toolKey) ?? db;

        if (schemaReg.isTimeSeries) {
            return await handleTimeSeries(ctx, broker, effectiveDb, domain, action);
        }

        // Try to find the base schema from a tool that returns it
        const getToolReg = MeshToolSchemaRegistry.get(`${domain}.get`);
        const createToolReg = MeshToolSchemaRegistry.get(`${domain}.create`);
        const possibleSchema = getToolReg?.returns || createToolReg?.returns;

        if (!possibleSchema) {
            broker.logger.warn(`[DatabaseMiddleware] Could not find schema for domain ${domain}. Proceeding to next handler.`);
            return await next();
        }

        const schema: z.ZodType<BaseDoc> = possibleSchema as z.ZodType<BaseDoc>;
        const repo = effectiveDb.repo(schema, domain);

        let params: Record<string, unknown> = ctx.params;
        let result: unknown;

        const module = broker.getModule(domain);

        // Utility to bridge calls without 'any' where possible
        const serviceCtx = {
            broker,

            // `meta` carries who is calling -- `user.id`, `user.tenant_id` -- and beforeCrud is
            // where a module confines a query to that caller before the database sees it. Omitting
            // it here did not fail loudly: the hooks still ran, still received a structurally valid
            // IServiceContext (meta is optional), and simply could not see the caller. A module
            // scoping a collection therefore read `undefined` and either threw or, worse, returned
            // every row in the collection to whoever asked.
            //
            // ServiceBroker builds the identical field for ordinary tool handlers
            // (ServiceBroker.ts, `meta: ctx.meta`), which is why the same read succeeds in a tool
            // and failed here on the same request. There was never a reason for the two to differ.
            meta: ctx.meta,

            correlationId: ctx.correlationID || ctx.id,
            nodeID: broker.nodeID,

            // NEVER CHANGE THIS EVER. PERIOD.
            call: <K extends keyof IServiceToolRegistry>(
                a: K,
                p: IServiceToolRegistry[K]['params'],
                o?: { nodeID?: string; timeout?: number }
            ) => broker.call(a, p, o),
            emit: <K extends keyof EventRegistry>(
                e: K,
                p: EventRegistry[K],
                o?: { skipNetwork?: boolean }
            ) => broker.emit(e, p, o),
            logger: broker.logger
        };

        if (module) {
            const beforeResult = await module.beforeCrud(domain, action, params, serviceCtx);
            if (isRecord(beforeResult)) {
                params = beforeResult;
            }
        }

        try {
            switch (action) {
                case 'find': {
                    const options: FindOptions<BaseDoc> = {
                        query: isRecord(params.query) ? (params.query as StrictFilterQuery<BaseDoc>) : {},
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
                    const query = isRecord(params.query) ? (params.query as StrictFilterQuery<BaseDoc>) : {};
                    let sort: FindOptions<BaseDoc>['sort'] = undefined;
                    if (typeof params.sort === 'string' || Array.isArray(params.sort) || isRecord(params.sort)) {
                        sort = params.sort as FindOptions<BaseDoc>['sort'];
                    }
                    const offset = typeof params.offset === 'number' ? params.offset : undefined;
                    const fields = typeof params.fields === 'string' || Array.isArray(params.fields) ? params.fields : undefined;

                    result = await repo.findOne(query, { sort, offset, fields });
                    break;
                }
                case 'count': {
                    const query = isRecord(params.query) ? (params.query as StrictFilterQuery<BaseDoc>) : {};
                    result = await repo.count(query);
                    break;
                }
                case 'get': {
                    const id = typeof params.id === 'string' ? params.id : '';
                    const doc = await repo.get(id);
                    if (!doc) {
                        throw new MeshError({ code: 'NOT_FOUND', status: 404, message: `${domain} not found: ${id}` });
                    }
                    result = doc;
                    break;
                }
                case 'create': {
                    const createRes = await repo.create(params as unknown as BaseDoc);
                    broker.emit('data.created', { domain, id: createRes.id, item: createRes as Record<string, unknown> });
                    emitNamed(broker, domain, 'created', createRes as Record<string, unknown>);
                    result = createRes;
                    break;
                }
                case 'create_many': {
                    const arr = Array.isArray(params) ? params : [params];
                    const created: BaseDoc[] = [];
                    for (const item of arr) {
                        if (isRecord(item)) {
                            const res = await repo.create(item as unknown as BaseDoc);
                            created.push(res);
                            broker.emit('data.created', { domain, id: res.id, item: res as Record<string, unknown> });
                            emitNamed(broker, domain, 'created', res as Record<string, unknown>);
                        }
                    }
                    result = created;
                    break;
                }
                case 'update': {
                    const id = typeof params.id === 'string' ? params.id : '';
                    const updateRes = await repo.update(id, params as unknown as Partial<BaseDoc>);
                    if (updateRes) {
                        broker.emit('data.updated', {
                            domain,
                            id: updateRes.id,
                            patch: params as Record<string, unknown>,
                            item: updateRes as Record<string, unknown>
                        });
                        emitNamed(broker, domain, 'updated', {
                            id: updateRes.id,
                            patch: params as Record<string, unknown>,
                            item: updateRes as Record<string, unknown>
                        });
                    }
                    result = updateRes;
                    break;
                }
                case 'replace': {
                    const id = typeof params.id === 'string' ? params.id : '';
                    const replaceRes = await repo.replace(id, params as unknown as BaseDoc);
                    if (replaceRes) {
                        broker.emit('data.updated', {
                            domain,
                            id: replaceRes.id,
                            patch: params as Record<string, unknown>,
                            item: replaceRes as Record<string, unknown>
                        });
                        emitNamed(broker, domain, 'updated', {
                            id: replaceRes.id,
                            patch: params as Record<string, unknown>,
                            item: replaceRes as Record<string, unknown>
                        });
                    }
                    result = replaceRes;
                    break;
                }
                case 'delete': {
                    const id = typeof params.id === 'string' ? params.id : '';
                    const success = await repo.delete(id);
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
                    result = await repo.get(id);
                    break;
                }
                default:
                    return await next(); // Pass through unknown actions
            }

            if (module) {
                result = await module.afterCrud(domain, action, result, serviceCtx);
            }

            return result;
        } catch (error) {
            broker.logger.error(`[DatabaseMiddleware] Failed to execute CRUD action ${action} for domain ${domain}`, { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    };
}

async function handleTimeSeries(
    ctx: IContext<Record<string, unknown>, Record<string, unknown>>,
    broker: IServiceBroker,
    db: Database,
    domain: string,
    action: string
): Promise<unknown> {
    const queryToolReg = MeshToolSchemaRegistry.get(`${domain}.query`);
    const possibleSchema = queryToolReg?.returns;

    if (!possibleSchema) {
        broker.logger.warn(`[DatabaseMiddleware] Could not find schema for TS domain ${domain}.`);
        return undefined;
    }

    // output of query is z.array(outputSchema)
    const outputSchema = (possibleSchema as z.ZodArray<z.ZodType<TSPoint>>).element;
    const repo = db.tsRepo(outputSchema, domain);
    const params = ctx.params;

    try {
        switch (action) {
            case 'insert':
                const points = Array.isArray(params) ? params : [params];
                return await repo.insert(points as unknown as Partial<TSPoint>[]);
            case 'query':
                return await repo.query(params as unknown as { from?: Date; to?: Date; tags?: Record<string, string>; limit?: number });
            case 'aggregate':
                return await repo.aggregate(params as unknown as { from?: Date; to?: Date; tags?: Record<string, string>; interval: string; aggregates: Record<string, 'min' | 'max' | 'avg' | 'sum' | 'count'> });
            case 'latest':
                return await repo.latest(params.tags as Record<string, string> | undefined);
            default:
                throw new Error(`Unknown TS action: ${action}`);
        }
    } catch (error) {
        broker.logger.error(`[DatabaseMiddleware] TS error in ${domain}.${action}: ${error}`);
        throw error;
    }
}
