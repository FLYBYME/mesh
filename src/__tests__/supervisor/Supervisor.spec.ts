import fs from 'fs';
import os from 'os';
import path from 'path';
import { createTestApp, destroyTestApp, dropTestDatabase } from '../helpers/setup.js';
import { MeshApp } from '../../core/MeshApp.js';
import { IServiceBroker } from '../../interfaces/IServiceBroker.js';
import { loadManifest, topologicalOrder, Supervisor, SupervisorManifest } from '../../supervisor/Supervisor.js';
import { SupervisorService } from '../../supervisor/SupervisorService.js';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/supervisor');

describe('topologicalOrder()', () => {
    it('orders entries so every dependency comes before its dependent', () => {
        const order = topologicalOrder([
            { name: 'c', path: 'c.js', dependsOn: ['a', 'b'] },
            { name: 'a', path: 'a.js', dependsOn: [] },
            { name: 'b', path: 'b.js', dependsOn: ['a'] },
        ]);
        expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
        expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
    });

    it('throws a real error naming the cycle, rather than silently truncating', () => {
        expect(() =>
            topologicalOrder([
                { name: 'x', path: 'x.js', dependsOn: ['y'] },
                { name: 'y', path: 'y.js', dependsOn: ['x'] },
            ])
        ).toThrow(/dependency cycle.*x.*y|dependency cycle.*y.*x/i);
    });
});

describe('loadManifest()', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-supervisor-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('loads and validates a real manifest file from disk', () => {
        const { manifest, baseDir } = loadManifest(path.join(FIXTURES_DIR, 'manifest.json'));
        expect(manifest.services).toHaveLength(2);
        expect(baseDir).toBe(FIXTURES_DIR);
    });

    it('rejects a manifest with a duplicate service name', () => {
        const p = path.join(tmpDir, 'dup.json');
        fs.writeFileSync(p, JSON.stringify({
            services: [
                { name: 'a', path: './a.js' },
                { name: 'a', path: './b.js' },
            ],
        }));
        expect(() => loadManifest(p)).toThrow(/duplicate service name/i);
    });

    it('rejects a manifest whose dependsOn references an unknown service', () => {
        const p = path.join(tmpDir, 'bad-dep.json');
        fs.writeFileSync(p, JSON.stringify({
            services: [{ name: 'a', path: './a.js', dependsOn: ['ghost'] }],
        }));
        expect(() => loadManifest(p)).toThrow(/depends on unknown service "ghost"/i);
    });

    it('throws for a nonexistent manifest file', () => {
        expect(() => loadManifest(path.join(tmpDir, 'nope.json'))).toThrow(/not found/i);
    });
});

// Real, load-bearing integration tests: a real MeshApp/ServiceBroker, real
// dynamic import() of real fixture .service.ts files from disk, real
// dependency-ordered start/stop, real cascade guard, and proof that a
// restarted service is genuinely a fresh instance, not the same object.
describe('Supervisor — real dynamic lifecycle', () => {
    let app: MeshApp;
    let broker: IServiceBroker;
    let manifest: SupervisorManifest;
    let baseDir: string;

    beforeAll(async () => {
        app = await createTestApp('supervisor-test-node');
        broker = app.getProvider<IServiceBroker>('broker');
        ({ manifest, baseDir } = loadManifest(path.join(FIXTURES_DIR, 'manifest.json')));
    });

    afterAll(async () => {
        await destroyTestApp(app);
        await dropTestDatabase();
    });

    it('starts services in dependency order and makes their tools real, live, callable contracts', async () => {
        const supervisor = new Supervisor(app, manifest, baseDir);
        const results = await supervisor.startAll();

        expect(results.find((r) => r.name === 'alpha')?.status).toBe('running');
        expect(results.find((r) => r.name === 'alpha')?.domain).toBe('sup-alpha');
        expect(results.find((r) => r.name === 'beta')?.status).toBe('running');
        expect(results.find((r) => r.name === 'beta')?.domain).toBe('sup-beta');

        const alphaPing = await broker.call('sup-alpha.ping' as never, {} as never);
        expect((alphaPing as { instanceId: string }).instanceId).toBeTruthy();
        const betaPing = await broker.call('sup-beta.ping' as never, {} as never);
        expect((betaPing as { ok: boolean }).ok).toBe(true);

        // Refuses to stop alpha while beta (a running dependent) still needs it.
        await expect(supervisor.serviceStop('alpha')).rejects.toThrow(/still depended on by running service/i);

        // Cascade stops beta first, then alpha; both tools are really gone afterward.
        await supervisor.serviceStop('alpha', { cascade: true });
        expect(supervisor.serviceStatus('alpha')[0].status).toBe('stopped');
        expect(supervisor.serviceStatus('beta')[0].status).toBe('stopped');
        await expect(broker.call('sup-alpha.ping' as never, {} as never)).rejects.toThrow(/not found/i);
        await expect(broker.call('sup-beta.ping' as never, {} as never)).rejects.toThrow(/not found/i);

        // Can't start a dependent before its dependency is running again.
        await expect(supervisor.serviceStart('beta')).rejects.toThrow(/dependency not running/i);

        // Bring only alpha back up, and prove restart yields a genuinely new instance.
        await supervisor.serviceStart('alpha');
        const before = (await broker.call('sup-alpha.ping' as never, {} as never)) as { instanceId: string };
        await supervisor.serviceRestart('alpha');
        const after = (await broker.call('sup-alpha.ping' as never, {} as never)) as { instanceId: string };
        expect(after.instanceId).not.toBe(before.instanceId);

        // Clean up so subsequent tests in this file start from a known state.
        await supervisor.serviceStop('alpha');
    });

    it('marks a service "error" when its path fails to import, and skips (also "error") any dependent rather than starting it against a broken dependency', async () => {
        const brokenManifest: SupervisorManifest = {
            services: [
                { name: 'bogus', path: './does-not-exist.service.js', dependsOn: [] },
                { name: 'dependent', path: path.join(FIXTURES_DIR, 'beta.service.ts'), dependsOn: ['bogus'] },
            ],
        };
        const supervisor = new Supervisor(app, brokenManifest, FIXTURES_DIR);
        const results = await supervisor.startAll();

        const bogus = results.find((r) => r.name === 'bogus')!;
        expect(bogus.status).toBe('error');
        expect(bogus.error).toBeTruthy();

        const dependent = results.find((r) => r.name === 'dependent')!;
        expect(dependent.status).toBe('error');
        expect(dependent.error).toMatch(/dependency not running/i);
    });

    it('exposes the same lifecycle through real supervisor.* mesh contracts', async () => {
        const supervisor = new Supervisor(app, manifest, baseDir);
        await app.registerModule(new SupervisorService(supervisor));

        const startResult = await broker.call('supervisor.service_start' as never, { name: 'alpha' } as never) as { status: string };
        expect(startResult.status).toBe('running');

        const statusAll = await broker.call('supervisor.service_status' as never, {} as never) as { services: { name: string }[] };
        expect(statusAll.services.map((s) => s.name).sort()).toEqual(['alpha', 'beta']);

        await broker.call('supervisor.service_start' as never, { name: 'beta' } as never);
        const stopResult = await broker.call('supervisor.service_stop' as never, { name: 'alpha', cascade: true } as never) as { status: string };
        expect(stopResult.status).toBe('stopped');

        await (broker as unknown as { unregisterModule(domain: string): Promise<void> }).unregisterModule('supervisor');
    });
});
