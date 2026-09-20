import { z } from 'zod';
import { createTestApp, destroyTestApp, dropTestCollection } from '../helpers/setup.js';
import { MeshApp } from '../../core/MeshApp.js';
import { defineCrud } from '../../interfaces/ICrudContract.js';
import { IServiceBroker } from '../../interfaces/IServiceBroker.js';
import type { IServiceContext } from '../../interfaces/IServiceContext.js';

/**
 * **The bug this was written for can no longer be expressed, and the test is kept for the
 * behaviour rather than the premise.**
 *
 * It caught a hook silently never running: under `ServiceModule`, a module could mount a CRUD hook
 * for a domain other than its own, and the lookup that found hooks went via
 * `getModule(domain)` -- which only ever matched a module's *own* top-level domain. So the hook
 * was registered, looked correct, and was never found. `DatabaseMiddleware` treated a missing
 * module as "nothing to run" rather than an error, so the write went through unhooked, in silence.
 *
 * With contracts there is no module to look up: `registerCrudHook(domain, action, hooks)` is keyed
 * by the domain it is *for*, so a mismatch between "who registered it" and "what it is for" has
 * nowhere to live. What is still worth asserting is the outcome -- a hook registered for a
 * collection runs on that collection's writes, and its return value replaces the params.
 *
 * Original note, kept because it explains why the shape existed at all:
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

const widgetCrud = defineCrud('widget', widgetSchema, { dependencies: [], filePath: 'src/__tests__/db/CrudHookDomainMismatch.spec.ts', permissions: [] });

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
describe('a CRUD hook registered for a collection', () => {
    let app: MeshApp;
    let broker: IServiceBroker;

    beforeAll(async () => {
        await dropTestCollection('widget');
        app = await createTestApp('crud-hook-domain-mismatch-node');
        broker = app.getProvider<IServiceBroker>('broker');
        broker.registerCrud(widgetCrud);
        broker.registerCrudHook('widget', 'create', {
            before: async (input: unknown, _ctx: IServiceContext) => {
                seenInHook.push(input);
                const params = typeof input === 'object' && input !== null ? { ...input } : {};
                // Overwrites, the same way CrudHookMeta.spec.ts's scoped hook does, so a passing
                // test can only mean the hook actually ran, not that the input happened to agree.
                return { ...params, tenantId: 'stamped-by-hook' };
            },
        });
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
