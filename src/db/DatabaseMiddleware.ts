import { IMiddleware } from '../interfaces/IInterceptor.js';
import { IContext } from '../interfaces/IContext.js';
import { IServiceBroker } from '../interfaces/IServiceBroker.js';
import { MeshToolSchemaRegistry } from '../core/ServiceBroker.js';
import { Database } from './Database.js';
import { StrictFilterQuery } from './types.js';
import { z } from 'zod';

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
        const schema = (getToolReg?.returns || createToolReg?.returns) as z.ZodTypeAny;

        if (!schema) {
            broker.logger.warn(`[DatabaseMiddleware] Could not find schema for domain ${domain}. Proceeding to next handler.`);
            return await next();
        }

        const repo = db.repo(schema, domain);
        let params = ctx.params as Record<string, unknown>;
        let result: unknown;

        const module = broker.getModule(domain);
        let serviceCtx: any = null;

        if (module) {
            serviceCtx = {
                correlationId: ctx.correlationID || ctx.id,
                nodeID: broker.nodeID,
                call: async (a: any, p: any, o?: any) => broker.call(a, p, o),
                emit: (e: any, p: any, o?: any) => broker.emit(e, p, o)
            };
            params = await module.beforeCrud(domain, action, params, serviceCtx) as Record<string, unknown>;
        }

        try {
            switch (action) {
                case 'find':
                    result = await repo.find(params);
                    break;
                case 'find_one':
                    result = await repo.findOne(
                        (params.query ?? {}) as StrictFilterQuery<{ id: string }>,
                        {
                            sort: params.sort as Partial<Record<string, 1 | -1>> | undefined,
                            offset: typeof params.offset === 'number' ? params.offset : undefined
                        }
                    );
                    break;
                case 'count':
                    result = await repo.count(params.query as any);
                    break;
                case 'get':
                    result = await repo.get(params.id as string);
                    break;
                case 'create':
                    result = await repo.create(params);
                    broker.emit('data.created', { domain, id: (result as any).id, item: result as Record<string, unknown> });
                    break;
                case 'create_many': {
                    const arr = Array.isArray(params) ? params : [params];
                    const created = [];
                    for (const item of arr) {
                        const res = await repo.create(item as any);
                        created.push(res);
                        broker.emit('data.created', { domain, id: (res as any).id, item: res as Record<string, unknown> });
                    }
                    result = created;
                    break;
                }
                case 'update':
                    result = await repo.update(params.id as string, params);
                    if (result) broker.emit('data.updated', { domain, id: (result as any).id, patch: params as Record<string, unknown>, item: result as Record<string, unknown> });
                    break;
                case 'replace':
                    result = await repo.replace(params.id as string, params as any);
                    if (result) broker.emit('data.updated', { domain, id: (result as any).id, patch: params as Record<string, unknown>, item: result as Record<string, unknown> });
                    break;
                case 'delete':
                    result = { success: await repo.delete(params.id as string) };
                    if ((result as any).success) broker.emit('data.deleted', { domain, id: params.id as string });
                    break;
                case 'resolve':
                    result = await repo.resolve(params as any);
                    break;
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
