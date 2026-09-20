import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createHandlerResolver, findPackageRoot, handlerCandidates, pickHandlerExport } from '../../loader/handlerResolver.js';
import type { ToolContract } from '../../interfaces/IToolContract.js';

/**
 * The resolver every repo migrating onto contract-driven placement needs: turn a contract's
 * declared `filePath` into the function that implements it.
 *
 * `createHandlerResolver` itself is covered by the integration tests that actually load parts --
 * what is worth unit-testing is the three decisions it makes, because each one is a place where
 * being subtly wrong is silent rather than loud.
 */
describe('findPackageRoot', () => {
    let tmp = '';

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-resolver-'));
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('finds the nearest ancestor with a package.json', () => {
        fs.writeFileSync(path.join(tmp, 'package.json'), '{}');
        const deep = path.join(tmp, 'src', 'billing', 'tools');
        fs.mkdirSync(deep, { recursive: true });

        expect(findPackageRoot(deep)).toBe(tmp);
    });

    it('prefers the nearest one, not the outermost', () => {
        fs.writeFileSync(path.join(tmp, 'package.json'), '{}');
        const inner = path.join(tmp, 'packages', 'billing');
        fs.mkdirSync(path.join(inner, 'src'), { recursive: true });
        fs.writeFileSync(path.join(inner, 'package.json'), '{}');

        expect(findPackageRoot(path.join(inner, 'src'))).toBe(inner);
    });

    it('says so rather than returning something wrong when there is none', () => {
        const orphan = path.join(tmp, 'nowhere');
        fs.mkdirSync(orphan);
        // tmpdir itself has no package.json on the way to /, so this walks to the root and stops.
        expect(() => findPackageRoot(orphan)).toThrow(/Could not locate a package root/);
    });
});

describe('handlerCandidates', () => {
    it('tries the declared source path first', () => {
        // Source first because that is where being wrong is silent: dist/ may hold a stale copy of
        // the same module and would load without complaint.
        const [first] = handlerCandidates('/repo', 'src/billing/tools/charge.ts');
        expect(first).toBe(path.join('/repo', 'src/billing/tools/charge.ts'));
    });

    it('offers the compiled path too, since the same code runs from dist', () => {
        const candidates = handlerCandidates('/repo', 'src/billing/tools/charge.ts');
        expect(candidates).toContain(path.join('/repo', 'dist/billing/tools/charge.js'));
    });

    it('honours a different output directory', () => {
        const candidates = handlerCandidates('/repo', 'src/billing/tools/charge.ts', 'build');
        expect(candidates).toContain(path.join('/repo', 'build/billing/tools/charge.js'));
    });

    it('offers only the literal path when it is not under src/', () => {
        expect(handlerCandidates('/repo', 'lib/charge.js')).toEqual([path.join('/repo', 'lib/charge.js')]);
    });
});

describe('pickHandlerExport', () => {
    const noop = async (): Promise<void> => {};

    it('prefers an export named for the action', () => {
        const chosen = pickHandlerExport({ charge: noop, other: noop }, 'charge', 'f.ts');
        expect(chosen).toBe(noop);
    });

    it('takes the sole exported function when the name differs', () => {
        // The common real case: a handler named for its collection *and* action, because a flat
        // tools/ directory cannot hold two files called issue.ts.
        const issueTicket = async (): Promise<void> => {};
        const chosen = pickHandlerExport({ issueTicket }, 'issue', 'src/identity/tools/issueTicket.ts');
        expect(chosen).toBe(issueTicket);
    });

    it('ignores non-function exports when counting', () => {
        const charge = async (): Promise<void> => {};
        const chosen = pickHandlerExport({ charge, SCHEMA: {}, LIMIT: 5 }, 'nope', 'f.ts');
        expect(chosen).toBe(charge);
    });

    it('refuses to guess between several, and names them', () => {
        expect(() => pickHandlerExport({ a: noop, b: noop }, 'charge', 'f.ts'))
            .toThrow(/exports 2 functions \(a, b\) and none is named "charge"/);
    });

    it('says the module exports nothing callable, rather than failing later', () => {
        expect(() => pickHandlerExport({ SCHEMA: {} }, 'charge', 'f.ts'))
            .toThrow(/exports no function/);
    });
});

describe('createHandlerResolver', () => {
    let tmp = '';

    const contract = (filePath: string, action = 'charge'): ToolContract =>
        ({ domain: 'billing', action, filePath }) as unknown as ToolContract;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-resolver-load-'));
        fs.writeFileSync(path.join(tmp, 'package.json'), '{}');
        fs.mkdirSync(path.join(tmp, 'src', 'billing', 'tools'), { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('uses the caller\'s own importer, which is what makes TypeScript handlers work', async () => {
        // Who performs the import matters. Under a transform-based runtime -- tsx, vitest --
        // only modules inside that runtime's graph get transformed, so a dynamic import() run
        // from inside node_modules refuses a .ts target outright. The consuming package passes
        // its own `load` for exactly this reason; found by hoisting this resolver out of
        // mesh-serve and watching every integration test fail on "Unknown file extension .ts".
        const handlerPath = path.join(tmp, 'src/billing/tools/charge.ts');
        fs.writeFileSync(handlerPath, '// would not import from here under a plain runtime');

        const charge = async (): Promise<string> => 'charged';
        const asked: string[] = [];
        const resolve = createHandlerResolver({
            root: tmp,
            load: async (url) => { asked.push(url); return { charge }; },
        });

        expect(await resolve(contract('src/billing/tools/charge.ts'))).toBe(charge);
        expect(asked[0]).toMatch(/^file:\/\//);
        expect(asked[0]).toContain('charge.ts');
    });

    it('names both places it looked when the handler is missing', async () => {
        const resolve = createHandlerResolver({ root: tmp, load: async () => ({}) });

        await expect(resolve(contract('src/billing/tools/nope.ts'))).rejects.toThrow(
            /billing\.charge.*declares filePath "src\/billing\/tools\/nope\.ts".*looked for.*and/s,
        );
    });

    it('falls back to the compiled path when the source is not there', async () => {
        fs.mkdirSync(path.join(tmp, 'dist', 'billing', 'tools'), { recursive: true });
        fs.writeFileSync(path.join(tmp, 'dist/billing/tools/charge.js'), '');

        const charge = async (): Promise<void> => {};
        const asked: string[] = [];
        const resolve = createHandlerResolver({
            root: tmp,
            load: async (url) => { asked.push(url); return { charge }; },
        });

        await resolve(contract('src/billing/tools/charge.ts'));
        expect(asked[0]).toContain('dist/billing/tools/charge.js');
    });

    /**
     * The real bug, reproduced with the real failure mode rather than a stub that always
     * succeeds: `existing.length === 0` never fires here, because an ordinary install ships
     * `src/` alongside `dist/` and the source candidate genuinely exists on disk. Every test above
     * used a `load` that never rejects, which is exactly what let this ship -- the resolver picked
     * the source candidate because it existed, not because anything could load it, and a plain
     * `node dist/...` process (no TypeScript loader registered) failed outright on the very first
     * candidate instead of ever trying the compiled one. Found live running a compiled
     * `mesh-serve` binary with plain `node`, not tsx.
     */
    it('falls through to the compiled candidate when the source one exists but cannot be loaded by this runtime', async () => {
        fs.writeFileSync(path.join(tmp, 'src/billing/tools/charge.ts'), '// unparseable without a TS loader');
        fs.mkdirSync(path.join(tmp, 'dist', 'billing', 'tools'), { recursive: true });
        fs.writeFileSync(path.join(tmp, 'dist/billing/tools/charge.js'), '');

        const charge = async (): Promise<void> => {};
        const asked: string[] = [];
        const resolve = createHandlerResolver({
            root: tmp,
            load: async (url) => {
                asked.push(url);
                if (url.endsWith('.ts')) {
                    const err = new Error(`Unknown file extension ".ts" for ${url}`);
                    (err as { code?: string }).code = 'ERR_UNKNOWN_FILE_EXTENSION';
                    throw err;
                }
                return { charge };
            },
        });

        expect(await resolve(contract('src/billing/tools/charge.ts'))).toBe(charge);
        expect(asked).toHaveLength(2);
        expect(asked[0]).toContain('charge.ts');
        expect(asked[1]).toContain('dist/billing/tools/charge.js');
    });

    it('does not swallow a real error inside the handler module -- only the unsupported-format one', async () => {
        fs.writeFileSync(path.join(tmp, 'src/billing/tools/charge.ts'), '// present, but loading it throws for real');

        const resolve = createHandlerResolver({
            root: tmp,
            load: async () => { throw new TypeError('a genuine bug inside the handler module'); },
        });

        await expect(resolve(contract('src/billing/tools/charge.ts')))
            .rejects.toThrow(/a genuine bug inside the handler module/);
    });

    it('says every candidate existed but none could be loaded, when all of them fail the same way', async () => {
        fs.writeFileSync(path.join(tmp, 'src/billing/tools/charge.ts'), '// no loader for this either');

        const resolve = createHandlerResolver({
            root: tmp,
            load: async (url) => {
                const err = new Error(`Unknown file extension ".ts" for ${url}`);
                (err as { code?: string }).code = 'ERR_UNKNOWN_FILE_EXTENSION';
                throw err;
            },
        });

        await expect(resolve(contract('src/billing/tools/charge.ts'))).rejects.toThrow(
            /exists on disk.*but this runtime could not load any of them/s,
        );
    });
});
