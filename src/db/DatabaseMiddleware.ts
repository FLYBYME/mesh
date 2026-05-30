import { IMiddleware } from '../interfaces/IInterceptor.js';
import { IContext } from '../interfaces/IContext.js';
import { IServiceBroker } from '../interfaces/IServiceBroker.js';
import { MeshToolSchemaRegistry } from '../core/ServiceBroker.js';
import { Database } from './Database.js';
import { FindOptions, StrictFilterQuery } from './types.js';
import { z } from 'zod';
import { IServiceModule } from '../interfaces/IServiceModule.js';
import { IServiceToolRegistry } from '../interfaces/IServiceContext.js';
import { EventRegistry } from '../interfaces/IEventContract.js';

interface BaseDoc {
    id: string;
    createdAt?: Date;
    updatedAt?: Date;
    [key: string]: unknown;
}

function isRecord(obj: unknown): obj is Record<string, unknown> {
    return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
}

function isStringArray(obj: unknown): obj is string[] {
    return Array.isArray(obj) && obj.every(i => typeof i === 'string');
}

export function createDatabaseMiddleware(broker: IServiceBroker, db: Database): IMiddleware {
    return async (ctx: IContext<Record<string, unknown>, Record<string, unknown>>, next) => {
        const toolKey = ctx.toolName;
        const schemaReg = MeshToolSchemaRegistry.get(toolKey);

        if (!schemaReg?.isCrud) {
            return await next();
        }

        const domain = schemaReg.domain;
        if (!domain) {
            return await next();
        }

        const action = toolKey.substring(domain.length + 1);

        // Try to find the base schema from a tool that returns it
        const getToolReg = MeshToolSchemaRegistry.get(`${domain}.get`);
        const createToolReg = MeshToolSchemaRegistry.get(`${domain}.create`);
        const possibleSchema = getToolReg?.returns || createToolReg?.returns;

        if (!possibleSchema) {
            broker.logger.warn(`[DatabaseMiddleware] Could not find schema for domain ${domain}. Proceeding to next handler.`);
            return await next();
        }

        const schema: z.ZodType<BaseDoc> = possibleSchema as z.ZodType<BaseDoc>;
        const repo = db.repo(schema, domain);

        let params: Record<string, unknown> = ctx.params;
        let result: unknown;

        const module = broker.getModule(domain);

        // Utility to bridge calls without 'any' where possible
        const serviceCtx = {
            broker,
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
                        limit: typeof params.limit === 'number' ? params.limit : undefined,
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

                    result = await repo.findOne(query, { sort, offset });
                    break;
                }
                case 'count': {
                    const query = isRecord(params.query) ? (params.query as StrictFilterQuery<BaseDoc>) : {};
                    result = await repo.count(query);
                    break;
                }
                case 'get': {
                    const id = typeof params.id === 'string' ? params.id : '';
                    result = await repo.get(id);
                    break;
                }
                case 'create': {
                    const createRes = await repo.create(params as any);
                    broker.emit('data.created', { domain, id: createRes.id, item: createRes as Record<string, unknown> });
                    result = createRes;
                    break;
                }
                case 'create_many': {
                    const arr = Array.isArray(params) ? params : [params];
                    const created: BaseDoc[] = [];
                    for (const item of arr) {
                        if (isRecord(item)) {
                            const res = await repo.create(item as any);
                            created.push(res);
                            broker.emit('data.created', { domain, id: res.id, item: res as Record<string, unknown> });
                        }
                    }
                    result = created;
                    break;
                }
                case 'update': {
                    const id = typeof params.id === 'string' ? params.id : '';
                    const updateRes = await repo.update(id, params as any);
                    if (updateRes) {
                        broker.emit('data.updated', {
                            domain,
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
                    const replaceRes = await repo.replace(id, params as any);
                    if (replaceRes) {
                        broker.emit('data.updated', {
                            domain,
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
                    }
                    break;
                }
                case 'resolve': {
                    if (isRecord(params)) {
                        result = await repo.resolve(params as Record<string, string | string[]>);
                    }
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
