import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { findPackageRoot, handlerCandidates, pickHandlerExport } from '../../loader/handlerResolver.js';

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
