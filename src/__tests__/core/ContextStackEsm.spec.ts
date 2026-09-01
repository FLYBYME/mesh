import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Context tracking, checked against the artifact we actually ship.
 *
 * Every other test in this repo runs through ts-jest, which transpiles to CommonJS. That is why
 * this file exists and why it spawns a real node process instead of importing anything.
 *
 * `ContextStack` used to initialise its AsyncLocalStorage with `require('node:async_hooks')` inside
 * a static block. Under ts-jest that works, because `require` exists in CommonJS. In the published
 * ESM build it threw, the `catch` labelled "Browser environment" swallowed it, and the storage was
 * never created -- so context tracking was **entirely absent from the shipped package** while 300+
 * tests passed.
 *
 * A test that imports ContextStack cannot catch that. It has to run the built output the way a
 * consumer does.
 */

const DIST = path.resolve(process.cwd(), 'dist');

/** Runs a snippet as an ES module in a fresh node process and returns its stdout. */
function runEsm(source: string): string {
    return execFileSync(process.execPath, ['--input-type=module', '--eval', source], {
        encoding: 'utf8',
        cwd: process.cwd(),
    }).trim();
}

const describeIfBuilt = existsSync(path.join(DIST, 'core', 'ContextStack.js')) ? describe : describe.skip;

describeIfBuilt('ContextStack in the published ESM build', () => {
    it('creates its AsyncLocalStorage', () => {
        // The direct assertion. Before the fix this printed "undefined": the storage was never
        // constructed, so `run` was a plain function call and `getContext` always answered nothing.
        const output = runEsm(`
            import { ContextStack } from '${path.join(DIST, 'core', 'ContextStack.js')}';
            const ctx = { id: 'a', toolName: 't', params: {}, meta: { user: { id: 'u', tenant_id: 'acme' } } };
            ContextStack.run(ctx, () => {
                console.log(ContextStack.getContext() === undefined ? 'undefined' : 'present');
            });
        `);

        expect(output).toBe('present');
    });

    it('keeps the context across an await', () => {
        // What a nested ctx.call actually depends on: the store surviving the microtask boundary
        // between a handler starting and it calling something else.
        const output = runEsm(`
            import { ContextStack } from '${path.join(DIST, 'core', 'ContextStack.js')}';
            const ctx = { id: 'a', toolName: 't', params: {}, meta: { user: { id: 'u', tenant_id: 'acme' } } };
            await ContextStack.run(ctx, async () => {
                await new Promise(resolve => setTimeout(resolve, 5));
                const seen = ContextStack.getContext();
                console.log(seen?.meta?.user?.tenant_id ?? 'lost');
            });
        `);

        expect(output).toBe('acme');
    });

    it('keeps separate contexts for concurrent calls', () => {
        // Two requests in flight is the normal case for a server, and a single shared variable
        // would pass both tests above while being useless here.
        const output = runEsm(`
            import { ContextStack } from '${path.join(DIST, 'core', 'ContextStack.js')}';
            const make = (tenant, delay) => ContextStack.run(
                { id: tenant, toolName: 't', params: {}, meta: { user: { id: 'u', tenant_id: tenant } } },
                async () => {
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return ContextStack.getContext()?.meta?.user?.tenant_id ?? 'lost';
                },
            );
            const [a, b] = await Promise.all([make('acme', 20), make('other', 1)]);
            console.log(a + ',' + b);
        `);

        expect(output).toBe('acme,other');
    });
});
