import assert from 'assert/strict';
import type { SupervisorTestContext } from '../../../supervisor/Supervisor.js';

// Real, normal-looking test functions: pass by resolving, fail by throwing (a plain
// assert, exactly like any other test runner). ctx.mountKey addresses *this* instance
// whether it's the real "sup-widget" mount or an aliased test mount -- the test doesn't
// need to know which.
export const tests: Record<string, (ctx: SupervisorTestContext) => Promise<void>> = {
    'create and find round-trip': async (ctx) => {
        const created = (await ctx.broker.call(`${ctx.mountKey}.create` as never, { name: 'widget-a' } as never)) as unknown as { id: string; name: string };
        assert.equal(created.name, 'widget-a');

        const found = (await ctx.broker.call(`${ctx.mountKey}.get` as never, { id: created.id } as never)) as unknown as { name: string };
        assert.equal(found.name, 'widget-a');
    },

    'deliberately fails, to prove failures are reported and don\'t abort the run': async () => {
        assert.equal(1 + 1, 3, 'intentional failure fixture');
    },
};
