import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ToolContract } from '../interfaces/IToolContract.js';

/**
 * `loadDomain`'s handler resolver for the unbundled case: import the module a contract's
 * `filePath` names, and return the export that implements it.
 *
 * This is the half that needs no build step. A contract already says where its code lives, so when
 * that file genuinely exists on disk -- running from source under tsx/vitest, or from `dist/` in an
 * ordinary install -- nothing has to be generated, listed, or kept in step. A bundle is the one
 * case this cannot serve, because bundling collapses those modules into a single file; there, the
 * build supplies a prebuilt handler map instead. Both read the same declaration.
 *
 * Lives here rather than in each consuming package because every repo migrating onto
 * contract-driven placement needs exactly this, and four hand-copied versions would drift.
 */

/**
 * The nearest ancestor of `startDir` containing a `package.json`.
 *
 * A resolver has to work from *two* genuinely different places: `dist/...` when a compiled build
 * runs, and `src/...` when the same code runs from source under tsx or vitest. A path relative to
 * the calling file is correct in exactly one of those and silently wrong in the other, which is
 * how this gets found -- "Cannot find module .../src/parts/identity.cjs" from a build that works.
 */
export function findPackageRoot(startDir: string): string {
    let dir = startDir;
    for (;;) {
        if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) {
            throw new Error(`Could not locate a package root walking up from "${startDir}".`);
        }
        dir = parent;
    }
}

/**
 * Where a declared `filePath` might actually be, in preference order.
 *
 * A contract declares its handler as a repo-relative source path (`src/hold/tools/decide.ts`),
 * which is the honest thing for it to say -- but the running process may be the compiled build,
 * where that module is `dist/hold/tools/decide.js`. Source is tried first because that is the case
 * where being wrong is silent: `dist/` may hold a stale copy of the same module and would load
 * without complaint.
 */
export function handlerCandidates(root: string, filePath: string, outDir = 'dist'): string[] {
    const fromSource = path.join(root, filePath);
    const compiled = filePath.startsWith('src/')
        ? path.join(root, outDir, filePath.slice('src/'.length).replace(/\.ts$/, '.js'))
        : undefined;

    return compiled === undefined ? [fromSource] : [fromSource, compiled];
}

/**
 * Picks the exported function implementing `action`.
 *
 * An exact match on the action name wins. Failing that, a module exporting exactly one function is
 * unambiguous and is taken -- which matters because a handler is often named for its collection
 * *and* action (`identity.ticket.issue` -> `issueTicket`), since a flat `tools/` directory cannot
 * hold two files called `issue.ts`. Anything else is genuinely ambiguous and says so rather than
 * guessing.
 */
export function pickHandlerExport(
    module: Record<string, unknown>,
    action: string,
    filePath: string,
): (params: never, ctx: never) => Promise<unknown> {
    const direct = module[action];
    if (typeof direct === 'function') return direct as (params: never, ctx: never) => Promise<unknown>;

    const functions = Object.entries(module).filter(([, value]) => typeof value === 'function');
    if (functions.length === 1) return functions[0]![1] as (params: never, ctx: never) => Promise<unknown>;

    const names = functions.map(([name]) => name);
    throw new Error(
        names.length === 0
            ? `"${filePath}" exports no function, but a contract declares it as the implementation of "${action}".`
            : `"${filePath}" exports ${names.length} functions (${names.join(', ')}) and none is named "${action}" -- rename the handler to match the action, or point filePath at a module with only it.`,
    );
}

export interface HandlerResolverOptions {
    /**
     * The consuming package's root -- the directory its contracts' `filePath`s are relative to.
     *
     * Required, and deliberately not derived from this module's own location: that would find
     * `@flybyme/mesh`'s root, never the caller's. A caller gets its own with
     * `findPackageRoot(path.dirname(fileURLToPath(import.meta.url)))`.
     */
    readonly root: string;
    /** Where compiled output lives, when the declared source path does not exist. Default `dist`. */
    readonly outDir?: string;
    /**
     * Performs the actual import. **Pass `(url) => import(url)` from the consuming package** when
     * anything might resolve to TypeScript.
     *
     * Who performs the import turns out to matter. Under a transform-based runtime -- tsx, vitest,
     * ts-node -- only modules inside that runtime's own graph get transformed. A dynamic `import()`
     * executed from here runs from inside `node_modules`, outside that graph, and Node refuses a
     * `.ts` target with "Unknown file extension". The same call written in the consuming package
     * works, because the runtime sees it.
     *
     * The default is correct whenever both sides are compiled JavaScript, which is every ordinary
     * production install.
     */
    readonly load?: (url: string) => Promise<unknown>;
}

/**
 * Builds the `resolve` function `broker.loadDomain(domain, handlers, { resolve })` takes.
 *
 * ```ts
 * const root = findPackageRoot(path.dirname(fileURLToPath(import.meta.url)));
 * const resolve = createHandlerResolver({ root, load: (url) => import(url) });
 * await broker.loadDomain('billing', {}, { resolve });
 * ```
 *
 * Pass `load` from the consuming package whenever handlers might be TypeScript -- see the option's
 * own note. Omitting it is right only when everything involved is compiled JavaScript.
 */
export function createHandlerResolver(
    options: HandlerResolverOptions,
): (contract: ToolContract) => Promise<unknown> {
    const { root, outDir = 'dist', load = (url: string): Promise<unknown> => import(url) } = options;

    return async (contract: ToolContract): Promise<unknown> => {
        const candidates = handlerCandidates(root, contract.filePath, outDir);
        const found = candidates.find((candidate) => fs.existsSync(candidate));

        if (found === undefined) {
            throw new Error(
                `Handler for "${contract.domain}.${contract.action}" not found. Its contract declares filePath "${contract.filePath}"; looked for ${candidates.map((c) => `"${c}"`).join(' and ')}.`,
            );
        }

        // pathToFileURL, not the bare path: Node's dynamic import() accepts an absolute POSIX path
        // by convention rather than by spec, and a Windows host would refuse it outright.
        const module = await load(pathToFileURL(found).href) as Record<string, unknown>;
        return pickHandlerExport(module, contract.action, contract.filePath);
    };
}
