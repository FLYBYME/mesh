import { z } from 'zod';
import { createTestApp, destroyTestApp, dropTestCollection } from '../helpers/setup.js';
import { MeshApp } from '../../core/MeshApp.js';
import { ServiceModule } from '../../core/ServiceModule.js';
import { defineCrud } from '../../interfaces/ICrudContract.js';
import { IServiceBroker } from '../../interfaces/IServiceBroker.js';
import type { IServiceContext } from '../../interfaces/IServiceContext.js';

/**
 * beforeCrud and afterCrud must be able to see who is calling.
 *
 * `meta` is how the identity of a caller reaches a handler -- `user.id`, `user.tenant_id` -- and
 * beforeCrud is the one place a module can confine a query to that caller *before the database
 * sees it*. DatabaseMiddleware used to build its own IServiceContext for the hooks and leave `meta`
 * off it.
 *
 * That failed quietly, which is what makes it worth a test rather than just a fix. The hooks ran.
 * They received a structurally valid IServiceContext, because `meta` is optional. They simply could
 * not see the caller -- so a module scoping a collection either threw on every request or, if it
 * was written to tolerate a missing scope, returned every row in the collection to whoever asked.
 *
 * The same read has always worked inside an ordinary tool handler, because ServiceBroker sets
 * `meta: ctx.meta` when it builds *that* context. These tests pin the two together.
 */

const RecordSchema = z.object({
    tenantId: z.string(),
    label: z.string(),
});

const scopedCrud = defineCrud('scoped', RecordSchema, { dependencies: [] });

declare global {
    interface IServiceToolRegistry {
        'scoped.create': { params: { tenantId: string; label: string }; returns: { id: string; tenantId: string; label: string } };
        'scoped.find': { params: { query?: Record<string, unknown> }; returns: { id: string; tenantId: string; label: string }[] };
    }
}

/**
 * What a caller puts in the tenant field, which the hook is expected to overwrite.
 *
 * `tenantId` is required by the generated create contract, and that validation runs *before* the
 * hooks do -- so a caller must send something. Sending a deliberately wrong value is the more
 * useful test anyway: it is the difference between a scope and a suggestion.
 */
const CLAIMED = 'claimed-by-the-caller';

/** What each hook saw, so the assertions can be about the context rather than only the effect. */
interface Seen {
    before: (string | undefined)[];
    after: (string | undefined)[];
}

const seen: Seen = { before: [], after: [] };

function tenantOf(ctx: IServiceContext): string | undefined {
    return ctx.meta?.user?.tenant_id;
}

/**
 * A collection confined to the caller's tenant, the way a real one would be: the scope is merged
 * into the query in `before` and stamped onto the document on create. Nothing in the handler.
 */
class ScopedModule extends ServiceModule {
    public readonly domain = 'scoped';

    constructor() {
        super();
        this.mountCrud(scopedCrud);

        this.mountCrudHook('scoped', 'find', {
            before: async (input, ctx) => {
                const tenantId = tenantOf(ctx);
                seen.before.push(tenantId);
                const params = typeof input === 'object' && input !== null ? { ...input } : {};
                const query = typeof params.query === 'object' && params.query !== null ? params.query : {};
                // Overwrites rather than merges: a caller-supplied tenantId must not widen this.
                return { ...params, query: { ...query, tenantId } };
            },
            after: async (output, ctx) => {
                seen.after.push(tenantOf(ctx));
                return output;
            },
        });

        this.mountCrudHook('scoped', 'create', {
            before: async (input, ctx) => {
                const tenantId = tenantOf(ctx);
                seen.before.push(tenantId);
                const params = typeof input === 'object' && input !== null ? { ...input } : {};
                return { ...params, tenantId };
            },
        });
    }
}

describe('CRUD hooks receive the caller meta', () => {
    let app: MeshApp;
    let broker: IServiceBroker;

    beforeAll(async () => {
        await dropTestCollection('scoped');
        app = await createTestApp('crud-hook-meta-node');
        broker = app.getProvider<IServiceBroker>('broker');
        await app.registerModule(new ScopedModule());
    });

    afterAll(async () => {
        await destroyTestApp(app);
    });

    beforeEach(async () => {
        await dropTestCollection('scoped');
        seen.before = [];
        seen.after = [];
    });

    it('gives beforeCrud the caller tenant', async () => {
        await broker.call('scoped.create', { label: 'one', tenantId: CLAIMED }, { meta: { user: { id: 'u1', tenant_id: 'acme' } } });

        expect(seen.before).toEqual(['acme']);
    });

    it('gives afterCrud the caller tenant', async () => {
        await broker.call('scoped.find', {}, { meta: { user: { id: 'u1', tenant_id: 'acme' } } });

        expect(seen.after).toEqual(['acme']);
    });

    it('stamps a created document with the caller tenant rather than the input', async () => {
        // The body says one thing and the caller is another. The hook must win: this is the
        // difference between a scope and a suggestion.
        const doc = await broker.call(
            'scoped.create',
            { label: 'one', tenantId: 'someone-else' },
            { meta: { user: { id: 'u1', tenant_id: 'acme' } } },
        );

        expect(doc.tenantId).toBe('acme');
    });

    it('confines a find to the caller tenant', async () => {
        await broker.call('scoped.create', { label: 'acme-1', tenantId: CLAIMED }, { meta: { user: { id: 'u1', tenant_id: 'acme' } } });
        await broker.call('scoped.create', { label: 'acme-2', tenantId: CLAIMED }, { meta: { user: { id: 'u1', tenant_id: 'acme' } } });
        await broker.call('scoped.create', { label: 'other-1', tenantId: CLAIMED }, { meta: { user: { id: 'u2', tenant_id: 'other' } } });
        await new Promise(resolve => setTimeout(resolve, 200));

        const acme = await broker.call('scoped.find', {}, { meta: { user: { id: 'u1', tenant_id: 'acme' } } });
        const other = await broker.call('scoped.find', {}, { meta: { user: { id: 'u2', tenant_id: 'other' } } });

        // The assertion that matters. Before the fix both callers saw all three rows, because the
        // hook merged `tenantId: undefined` into the query and matched everything.
        expect(acme.map(doc => doc.label).sort()).toEqual(['acme-1', 'acme-2']);
        expect(other.map(doc => doc.label)).toEqual(['other-1']);
    });

    it('does not let a caller widen the query past their own tenant', async () => {
        await broker.call('scoped.create', { label: 'acme-1', tenantId: CLAIMED }, { meta: { user: { id: 'u1', tenant_id: 'acme' } } });
        await broker.call('scoped.create', { label: 'other-1', tenantId: CLAIMED }, { meta: { user: { id: 'u2', tenant_id: 'other' } } });
        await new Promise(resolve => setTimeout(resolve, 200));

        const attempt = await broker.call(
            'scoped.find',
            { query: { tenantId: 'other' } },
            { meta: { user: { id: 'u1', tenant_id: 'acme' } } },
        );

        expect(attempt.map(doc => doc.label)).toEqual(['acme-1']);
    });

    it('reports no tenant when the call carries no user, rather than inventing one', async () => {
        await broker.call('scoped.find', {});

        expect(seen.before).toEqual([undefined]);
    });
});
