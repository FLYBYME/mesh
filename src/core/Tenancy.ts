import { MeshError } from './MeshError.js';
import { resolveCallerScope } from '../db/CrudExecutor.js';
import type { Database } from '../db/Database.js';
import type { DomainRepository } from '../db/DomainRepository.js';
import type { IServiceCollectionRegistry } from '../interfaces/ICrudContract.js';
import type { CrudRepo, IServiceContext } from '../interfaces/IServiceContext.js';
import { isRecord } from '../utils/isRecord.js';

/**
 * Who is calling, and as which organization -- once, here. Every service had its own copy of these
 * (resolveCallerTenant in 9 repos, asTenant in 8, everyTenant in 7) and they had drifted into five
 * versions by 10-10: compute read `meta.tenant_id` before `meta.user.tenant_id`, the opposite of
 * the database's own scope, and every copy refused with a plain Error the api answered 500.
 */

type Domain = keyof IServiceCollectionRegistry & string;

/**
 * The caller's organization, read exactly as `scopedBy: 'tenantId'` reads it (user.tenantId,
 * user.tenant_id, tenantId, tenant_id) -- or undefined when the call carries none.
 */
export function callerTenant(ctx: Pick<IServiceContext, 'meta'>): string | undefined {
    const meta: unknown = ctx.meta;

    return resolveCallerScope(isRecord(meta) ? meta : undefined, 'tenantId');
}

/** The caller's organization; a call with none is refused, 401. */
export function resolveCallerTenant(ctx: Pick<IServiceContext, 'meta'>): string {
    const tenantId = callerTenant(ctx);
    if (tenantId === undefined) {
        throw new MeshError({ message: 'This call carries no organization.', code: 'UNAUTHORIZED', status: 401 });
    }

    return tenantId;
}

/** The signed-in account calling, or undefined (an organization's own call, a system call). */
export function callerUserId(ctx: Pick<IServiceContext, 'meta'>): string | undefined {
    const user = isRecord(ctx.meta) ? ctx.meta.user : undefined;
    const id = isRecord(user) ? user.id : undefined;

    return typeof id === 'string' && id !== '' ? id : undefined;
}

/** The signed-in account calling; a call with none is refused, 401. */
export function resolveCallerUserId(ctx: Pick<IServiceContext, 'meta'>): string {
    const userId = callerUserId(ctx);
    if (userId === undefined) {
        throw new MeshError({ message: 'This call carries no signed-in account.', code: 'UNAUTHORIZED', status: 401 });
    }

    return userId;
}

/** Who did it, for a record: the signed-in account, else the organization. */
export function callerName(ctx: Pick<IServiceContext, 'meta'>, tenantId: string): string {
    return callerUserId(ctx) ?? tenantId;
}

/**
 * A collection as one organization sees it: scoped, hidden fields stripped, events emitted -- the
 * same `ctx.db`, run as that organization (by the platform: `user.id` 'platform'). Both scope names
 * are set, `tenant_id` and `organizationId`, so a collection scoped by either reads the same one.
 */
export function asTenant<D extends Domain>(ctx: Pick<IServiceContext, 'db'>, domain: D, tenantId: string): CrudRepo<D> {
    return ctx.db(domain, inOrganization(tenantId).meta);
}

/**
 * Call options that run a `ctx.call` in one organization: by the platform, or by the account named
 * (a person who placed an order, an agent). asTenant's twin, for another service's tools and
 * collections, which are reached through the broker, never `ctx.db`.
 */
export function inOrganization(tenantId: string, userId = 'platform'): { meta: { user: { id: string; tenant_id: string; organizationId: string } } } {
    return { meta: { user: { id: userId, tenant_id: tenantId, organizationId: tenantId } } };
}

/**
 * A collection across every organization: unscoped, hidden fields visible, no events, no hooks.
 * The database's deliberate escape hatch (`Database.collection`), for the platform's own sweeps and
 * operator tools that look up a record before knowing whose it is. Prefer `ctx.db` / `asTenant`.
 */
export function everyTenant<D extends Domain>(
    ctx: Pick<IServiceContext, 'broker'>,
    domain: D,
): DomainRepository<IServiceCollectionRegistry[D] & { id: string }> {
    return ctx.broker.getProvider<Database>('database').collection(domain);
}
