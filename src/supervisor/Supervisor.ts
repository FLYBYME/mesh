import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import type { MeshApp } from '../core/MeshApp.js';
import type { IServiceBroker } from '../interfaces/IServiceBroker.js';
import type { IServiceModule } from '../interfaces/IServiceModule.js';
import type { ILogger } from '../interfaces/ILogger.js';
import { Database } from '../db/Database.js';

// ─── Manifest ──────────────────────────────────────────────────────────────

export const SupervisorServiceEntrySchema = z.object({
    /** Stable identifier used to target this entry via the control surface. Not
     *  necessarily the same as the loaded module's own `domain`. */
    name: z.string().min(1),
    /** Where to dynamically `import()` the compiled service module from. Resolved
     *  relative to the manifest file's own directory if not absolute. */
    path: z.string().min(1),
    /** Other entries' `name`s that must be running before this one starts. */
    dependsOn: z.array(z.string()).default([]),
    /** Mounts this entry under a different local address than its own `domain`
     *  (ServiceBroker.registerModule's `key` option) -- lets a second, isolated
     *  instance of a domain already running elsewhere in this manifest coexist,
     *  e.g. a `-test` entry pointed at the same `path` as the real one. Omitted:
     *  mounted under its own domain, same as every entry before this existed. */
    mountKey: z.string().optional(),
    /** Backs this entry's own CRUD/time-series calls with a dedicated Database
     *  connection instead of the Supervisor's shared default (ServiceBroker.
     *  registerModule's `database` option) -- e.g. an isolated test database for
     *  a mountKey-aliased test entry, so it never touches the real instance's
     *  collections. Connected on serviceStart, disconnected on serviceStop.
     *  Omitted: uses the same shared database as every other entry. */
    database: z.object({ uri: z.string(), dbName: z.string() }).optional(),
    /** Where to dynamically `import()` this entry's associated tests from
     *  (supervisor.run_tests). Resolved the same way as `path`. Omitted: this
     *  entry has no associated tests -- run_tests reports a real, honest error
     *  rather than a silent empty pass. */
    testsPath: z.string().optional(),
});
export type SupervisorServiceEntry = z.infer<typeof SupervisorServiceEntrySchema>;

export const SupervisorManifestSchema = z.object({
    services: z.array(SupervisorServiceEntrySchema),
});
export type SupervisorManifest = z.infer<typeof SupervisorManifestSchema>;

/**
 * loadManifest: reads and validates a Supervisor config file from disk.
 * Real validation, not a loose parse -- an invalid shape, a duplicate `name`,
 * or a `dependsOn` naming an entry that doesn't exist are all real startup
 * errors, not silently ignored.
 */
export function loadManifest(filePath: string): { manifest: SupervisorManifest; baseDir: string } {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
        throw new Error(`[Supervisor] Manifest file not found: ${resolved}`);
    }

    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
    } catch (err) {
        throw new Error(`[Supervisor] Manifest at ${resolved} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }

    const manifest = SupervisorManifestSchema.parse(raw);

    const seen = new Set<string>();
    for (const entry of manifest.services) {
        if (seen.has(entry.name)) {
            throw new Error(`[Supervisor] Manifest at ${resolved} declares duplicate service name: "${entry.name}"`);
        }
        seen.add(entry.name);
    }
    for (const entry of manifest.services) {
        for (const dep of entry.dependsOn) {
            if (!seen.has(dep)) {
                throw new Error(`[Supervisor] Service "${entry.name}" depends on unknown service "${dep}"`);
            }
        }
    }

    return { manifest, baseDir: path.dirname(resolved) };
}

/**
 * topologicalOrder: Kahn's algorithm over `dependsOn`. Throws a real, specific
 * error naming the cycle members rather than silently truncating or ignoring it.
 */
export function topologicalOrder(entries: SupervisorServiceEntry[]): string[] {
    const byName = new Map(entries.map((e) => [e.name, e]));
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();

    for (const entry of entries) {
        inDegree.set(entry.name, entry.dependsOn.length);
        for (const dep of entry.dependsOn) {
            const list = dependents.get(dep) ?? [];
            list.push(entry.name);
            dependents.set(dep, list);
        }
    }

    const queue: string[] = [...inDegree.entries()].filter(([, deg]) => deg === 0).map(([name]) => name);
    const order: string[] = [];

    while (queue.length > 0) {
        const name = queue.shift()!;
        order.push(name);
        for (const dependent of dependents.get(name) ?? []) {
            const remaining = (inDegree.get(dependent) ?? 0) - 1;
            inDegree.set(dependent, remaining);
            if (remaining === 0) queue.push(dependent);
        }
    }

    if (order.length !== entries.length) {
        const stuck = [...byName.keys()].filter((name) => !order.includes(name));
        throw new Error(`[Supervisor] Manifest has a dependency cycle involving: ${stuck.join(', ')}`);
    }

    return order;
}

// ─── Runtime status ────────────────────────────────────────────────────────

export type SupervisorRunStatus = 'stopped' | 'running' | 'error';

export interface SupervisorServiceStatus {
    name: string;
    domain?: string;
    status: SupervisorRunStatus;
    dependsOn: string[];
    error?: string;
}

interface TrackedInstance {
    module: IServiceModule;
    /** The key this instance was actually registered under (entry.mountKey, or the
     *  module's own domain when unset) -- unregisterModule needs this exact key,
     *  not the domain, once a mount key is in play. */
    mountKey: string;
    /** This entry's own Database connection, if entry.database was set. Disconnected
     *  on serviceStop -- real resource teardown, not just a broker-level unmount. */
    database?: Database;
}

export interface SupervisorTestContext {
    broker: IServiceBroker;
    /** The mount key this entry's instance is actually registered under (its own domain,
     *  unless the manifest entry set `mountKey`). Build tool keys as `${mountKey}.<action>`
     *  to address *this specific instance* regardless of whether it's mounted under its
     *  real domain or an alias -- a test file shouldn't need to know which. */
    mountKey: string;
}

export interface SupervisorTestOutcome {
    name: string;
    ok: boolean;
    error?: string;
}

export interface SupervisorTestRunResult {
    passed: number;
    failed: number;
    results: SupervisorTestOutcome[];
}

/**
 * Supervisor — runs a whole fleet of services in one process, each dynamically
 * mounted/unmounted via ServiceBroker.registerModule/unregisterModule (Part 1).
 * See docs/SUPERVISOR_AND_SERVICE_LIFECYCLE.md, Part 2.
 */
export class Supervisor {
    private instances = new Map<string, TrackedInstance>();
    private statuses = new Map<string, SupervisorServiceStatus>();
    private byName: Map<string, SupervisorServiceEntry>;
    private order: string[];
    private logger: ILogger;

    constructor(
        private app: MeshApp,
        private manifest: SupervisorManifest,
        private baseDir: string
    ) {
        this.logger = app.logger.child({ name: 'Supervisor' });
        this.byName = new Map(manifest.services.map((e) => [e.name, e]));
        this.order = topologicalOrder(manifest.services);
        for (const entry of manifest.services) {
            this.statuses.set(entry.name, { name: entry.name, status: 'stopped', dependsOn: entry.dependsOn });
        }
    }

    private get broker(): IServiceBroker {
        return this.app.getProvider<IServiceBroker>('broker');
    }

    private resolvePath(entryPath: string): string {
        return path.isAbsolute(entryPath) ? entryPath : path.resolve(this.baseDir, entryPath);
    }

    /**
     * startAll: starts every manifest entry in dependency order. A service whose
     * dependency failed (or was skipped) is itself marked 'error' and skipped --
     * dependents are never silently started against a dependency that isn't real.
     */
    public async startAll(): Promise<SupervisorServiceStatus[]> {
        for (const name of this.order) {
            const entry = this.byName.get(name)!;
            const unmetDeps = entry.dependsOn.filter((dep) => this.statuses.get(dep)?.status !== 'running');
            if (unmetDeps.length > 0) {
                this.statuses.set(name, {
                    name,
                    status: 'error',
                    dependsOn: entry.dependsOn,
                    error: `Skipped: dependency not running: ${unmetDeps.join(', ')}`,
                });
                continue;
            }
            await this.serviceStart(name);
        }
        return this.serviceStatus();
    }

    /**
     * stopAll: stops every running entry in reverse dependency order, so
     * dependents are always torn down before what they depend on.
     */
    public async stopAll(): Promise<void> {
        for (const name of [...this.order].reverse()) {
            if (this.statuses.get(name)?.status === 'running') {
                try {
                    await this.serviceStop(name, { cascade: true });
                } catch (err) {
                    this.logger.error(`[Supervisor] Error stopping "${name}" during stopAll:`, {
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }
        }
    }

    public async serviceStart(name: string): Promise<SupervisorServiceStatus> {
        const entry = this.byName.get(name);
        if (!entry) {
            throw new Error(`[Supervisor] Unknown service: "${name}"`);
        }

        const current = this.statuses.get(name)!;
        if (current.status === 'running') {
            return current;
        }

        const unmetDeps = entry.dependsOn.filter((dep) => this.statuses.get(dep)?.status !== 'running');
        if (unmetDeps.length > 0) {
            throw new Error(`[Supervisor] Cannot start "${name}": dependency not running: ${unmetDeps.join(', ')}`);
        }

        let entryDb: Database | undefined;
        try {
            const resolved = this.resolvePath(entry.path);
            const imported = await import(resolved);
            const ServiceClass = (imported.default ?? Object.values(imported).find((v) => typeof v === 'function')) as
                | (new () => IServiceModule)
                | undefined;
            if (!ServiceClass) {
                throw new Error(`No exported service class found in ${resolved}`);
            }

            const instance = new ServiceClass();
            const mountKey = entry.mountKey ?? instance.domain;

            if (entry.database) {
                entryDb = new Database(this.logger, entry.database.uri, entry.database.dbName);
                await entryDb.connect();
            }

            await this.broker.registerModule(instance, { key: entry.mountKey, database: entryDb });

            this.instances.set(name, { module: instance, mountKey, database: entryDb });
            const status: SupervisorServiceStatus = { name, domain: instance.domain, status: 'running', dependsOn: entry.dependsOn };
            this.statuses.set(name, status);
            this.logger.info(`[Supervisor] Started "${name}" (domain: ${instance.domain}${mountKey !== instance.domain ? `, mount key: ${mountKey}` : ''})`);
            return status;
        } catch (err) {
            if (entryDb) {
                await entryDb.disconnect().catch(() => { });
            }
            const status: SupervisorServiceStatus = {
                name,
                status: 'error',
                dependsOn: entry.dependsOn,
                error: err instanceof Error ? err.message : String(err),
            };
            this.statuses.set(name, status);
            this.logger.error(`[Supervisor] Failed to start "${name}":`, { error: status.error });
            return status;
        }
    }

    public async serviceStop(name: string, options: { cascade?: boolean } = {}): Promise<SupervisorServiceStatus> {
        const entry = this.byName.get(name);
        if (!entry) {
            throw new Error(`[Supervisor] Unknown service: "${name}"`);
        }

        const current = this.statuses.get(name)!;
        if (current.status !== 'running') {
            return current;
        }

        const runningDependents = this.manifest.services
            .filter((e) => e.dependsOn.includes(name) && this.statuses.get(e.name)?.status === 'running')
            .map((e) => e.name);

        if (runningDependents.length > 0) {
            if (!options.cascade) {
                throw new Error(
                    `[Supervisor] Cannot stop "${name}": still depended on by running service(s): ${runningDependents.join(', ')}. Pass cascade: true to stop them first.`
                );
            }
            for (const dependent of runningDependents) {
                await this.serviceStop(dependent, { cascade: true });
            }
        }

        const tracked = this.instances.get(name);
        if (tracked) {
            await this.broker.unregisterModule(tracked.mountKey);
            if (tracked.database) {
                await tracked.database.disconnect();
            }
            this.instances.delete(name);
        }

        const status: SupervisorServiceStatus = { name, dependsOn: entry.dependsOn, status: 'stopped' };
        this.statuses.set(name, status);
        this.logger.info(`[Supervisor] Stopped "${name}"`);
        return status;
    }

    public async serviceRestart(name: string): Promise<SupervisorServiceStatus> {
        if (!this.byName.has(name)) {
            throw new Error(`[Supervisor] Unknown service: "${name}"`);
        }
        // Exactly unregisterModule followed by a fresh registerModule on a new
        // instance -- not a special code path, per docs/SUPERVISOR_AND_SERVICE_LIFECYCLE.md.
        await this.serviceStop(name);
        return this.serviceStart(name);
    }

    public serviceStatus(name?: string): SupervisorServiceStatus[] {
        if (name) {
            const status = this.statuses.get(name);
            if (!status) {
                throw new Error(`[Supervisor] Unknown service: "${name}"`);
            }
            return [status];
        }
        return this.manifest.services.map((e) => this.statuses.get(e.name)!);
    }

    /**
     * runTests: the actual Part 3 ask -- "I can call a contract and a set of tests will run
     * and return the result." Runs an entry's associated tests (its `testsPath` module's
     * `tests` export) for real, against its currently-running instance -- the same live
     * instance every other caller reaches via this Supervisor's own broker, not a fresh
     * throwaway one. Real isolation from a production instance of the same domain, when
     * wanted, comes from running a *separate* manifest entry with its own `mountKey`/
     * `database` (see the manifest fields above) and pointing run_tests at that entry's
     * `name` -- runTests itself doesn't decide isolation, the manifest does.
     *
     * Convention (deliberately the only one supported, not left as an open menu): the tests
     * module at `testsPath` exports `tests: Record<string, (ctx: SupervisorTestContext) =>
     * Promise<void>>`. A test passes by resolving, fails by throwing -- normal-looking unit
     * tests, no custom assertion library required.
     */
    public async runTests(name: string, testName?: string): Promise<SupervisorTestRunResult> {
        const entry = this.byName.get(name);
        if (!entry) {
            throw new Error(`[Supervisor] Unknown service: "${name}"`);
        }
        if (!entry.testsPath) {
            throw new Error(`[Supervisor] Service "${name}" has no testsPath configured -- nothing to run`);
        }
        if (this.statuses.get(name)?.status !== 'running') {
            throw new Error(`[Supervisor] Cannot run tests for "${name}": service is not running`);
        }
        const tracked = this.instances.get(name)!;

        const resolved = this.resolvePath(entry.testsPath);
        const imported = await import(resolved);
        const tests = imported.tests as Record<string, (ctx: SupervisorTestContext) => Promise<void>> | undefined;
        if (!tests || typeof tests !== 'object') {
            throw new Error(`[Supervisor] ${resolved} does not export a "tests" object`);
        }

        const namesToRun = testName ? [testName] : Object.keys(tests);
        if (testName && !tests[testName]) {
            throw new Error(`[Supervisor] Test "${testName}" not found for service "${name}" (available: ${Object.keys(tests).join(', ') || 'none'})`);
        }

        const ctx: SupervisorTestContext = { broker: this.broker, mountKey: tracked.mountKey };
        const results: SupervisorTestOutcome[] = [];
        for (const testCaseName of namesToRun) {
            try {
                await tests[testCaseName]!(ctx);
                results.push({ name: testCaseName, ok: true });
            } catch (err) {
                results.push({ name: testCaseName, ok: false, error: err instanceof Error ? err.message : String(err) });
            }
        }

        const passed = results.filter((r) => r.ok).length;
        const failed = results.length - passed;
        this.logger.info(`[Supervisor] Ran ${results.length} test(s) for "${name}": ${passed} passed, ${failed} failed`);
        return { passed, failed, results };
    }
}
