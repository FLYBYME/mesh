import { z } from 'zod';
import { createTestApp, destroyTestApp, dropTestCollection } from '../helpers/setup.js';
import { MeshApp } from '../../core/MeshApp.js';
import { ServiceModule } from '../../core/ServiceModule.js';
import { defineCrud } from '../../interfaces/ICrudContract.js';
import { IServiceBroker } from '../../interfaces/IServiceBroker.js';
import type { IServiceContext } from '../../interfaces/IServiceContext.js';

/**
 * A module's own `domain` and the domain a mountCrudHook is registered for are not required to
 * match -- `mountCrud`/`mountCrudHook` both take the CRUD's real domain as an explicit argument,
 * and the class comment on ServiceModule already documents a module owning a second domain (`demo`
 * also mounts `demometrics.*`).
 *
 * `ServiceBroker.getModule(domain)` used to look only for `m.domain === domain`, which finds the
 * module by its own top-level domain and nothing else. For a module whose own domain differs from a
 * domain it mounts a CRUD hook for -- exactly the `demometrics`-style pattern the framework already
 * claims to support -- that lookup silently returned `undefined`. `DatabaseMiddleware` treats a
 * missing module as "nothing to run" rather than an error (`if (module) { await
 * module.beforeCrud(...) }`), so the hook never ran, never logged anything, and the write went
 * through unvalidated. This pins the fix: a module registered under one domain, hooking a CRUD
 * mounted under a different one, must still have its hook run.
 */

const widgetSchema = z.object({
    tenantId: z.string(),
    label: z.string(),
});

const widgetCrud = defineCrud('widget', widgetSchema, { dependencies: [] });

declare global {
    interface IServiceToolRegistry {
        'widget.create': { params: { tenantId?: string; label: string }; returns: { id: string; tenantId: string; label: string } };
    }
}

const seenInHook: unknown[] = [];

/**
 * The whole point: this module's own `domain` ('widget_owner') is not 'widget', the domain its
 * CRUD and hook are registered under. Before the fix, `mountCrudHook('widget', 'create', ...)`
 * here was unreachable -- `getModule('widget')` could never find a module whose own domain is
 * `'widget_owner'`.
 */
class WidgetOwnerModule extends ServiceModule {
    public readonly domain = 'widget_owner';

    constructor() {
        super();
        this.mountCrud(widgetCrud);

        this.mountCrudHook('widget', 'create', {
            before: async (input: unknown, _ctx: IServiceContext) => {
                seenInHook.push(input);
                const params = typeof input === 'object' && input !== null ? { ...input } : {};
                // Overwrites, the same way CrudHookMeta.spec.ts's scoped hook does, so a passing
                // test can only mean the hook actually ran, not that the input happened to agree.
                return { ...params, tenantId: 'stamped-by-hook' };
            },
        });
    }
}

describe('a CRUD hook mounted under a domain other than the module\'s own', () => {
    let app: MeshApp;
    let broker: IServiceBroker;

    beforeAll(async () => {
        await dropTestCollection('widget');
        app = await createTestApp('crud-hook-domain-mismatch-node');
        broker = app.getProvider<IServiceBroker>('broker');
        await app.registerModule(new WidgetOwnerModule());
    });

    afterAll(async () => {
        await destroyTestApp(app);
    });

    beforeEach(async () => {
        await dropTestCollection('widget');
        seenInHook.length = 0;
    });

    it('still runs', async () => {
        const doc = await broker.call('widget.create', { label: 'one', tenantId: 'claimed' }, {});

        expect(seenInHook).toHaveLength(1);
        expect(doc.tenantId).toBe('stamped-by-hook');
    });
});
