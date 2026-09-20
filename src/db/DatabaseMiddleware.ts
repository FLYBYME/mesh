import { IMiddleware } from '../interfaces/IInterceptor.js';
import { IContext } from '../interfaces/IContext.js';
import { IServiceBroker } from '../interfaces/IServiceBroker.js';
import { MeshToolSchemaRegistry } from '../core/ServiceBroker.js';
import { Database } from './Database.js';
import { CrudExecutor } from './CrudExecutor.js';
import { z } from 'zod';

interface TSPoint {
    timestamp: Date;
    tags: Record<string, string>;
    [key: string]: unknown;
}

function isRecord(obj: unknown): obj is Record<string, unknown> {
    return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
}

// The exact set `defineCrud` generates by default (ICrudContract.ts's `actionNames`) -- gated on
// here, before ever calling CrudExecutor, so an unrecognized action (a domain that renamed one via
// defineCrud's own `options.actions`, or genuinely isn't CRUD) falls through to `next()` exactly as
// it always has, rather than becoming CrudExecutor's problem.
const KNOWN_CRUD_ACTIONS = new Set([
    'find', 'find_one', 'count', 'get', 'resolve', 'create', 'create_many', 'update', 'replace', 'delete',
]);

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

        // Split on the *last* dot, not `domain.length + 1`. A domain is itself dotted
        // (`serve.part.create`), so counting forward from the domain is fragile in a way this
        // isn't: an action name never contains a literal '.' -- dots are reserved as the
        // domain/action separator everywhere in this framework -- so the last dot is always the
        // real split point.
        const action = toolKey.substring(toolKey.lastIndexOf('.') + 1);
        // A contract registered with its own `database` (`registerContract`'s `options.database`,
        // which `loadDomain` and `registerCrud` forward to every action in the collection) routes
        // its CRUD/time-series calls there instead of this middleware's shared default -- e.g. one
        // domain living in a different Mongo connection or dbName. Falls back to the shared `db`
        // for everything that didn't ask for an override.
        const effectiveDb = broker.getDatabaseForTool(toolKey) ?? db;

        if (schemaReg.isTimeSeries) {
            return await handleTimeSeries(ctx, broker, effectiveDb, domain, action);
        }

        if (!KNOWN_CRUD_ACTIONS.has(action)) {
            return await next(); // Pass through unknown/renamed actions, same as always.
        }

        return await CrudExecutor.execute({ broker, db: effectiveDb }, { domain, action, params: ctx.params, meta: ctx.meta });
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
