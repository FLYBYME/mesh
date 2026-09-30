import { z } from 'zod';
import { MeshApp } from '../../core/MeshApp.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { PlacementRegistry } from '../../core/PlacementRegistry.js';
import { defineContract, defaultPrint, globalContractRegistry } from '../../interfaces/IToolContract.js';
import type { IServiceBroker } from '../../interfaces/IServiceBroker.js';

/**
 * Two copies of one contract in one process -- a stale one from a package another part *imports*,
 * and the current one the owning part *mounts* with its handler. Import-time definitions are
 * first-wins, so the stale copy used to decide what the contract looked like whenever its importer
 * loaded first.
 *
 * On edge1 (2026-09-30), after the host node restarted, mail-service loaded before certs; its copy
 * of surfdns-certs still had cert.ensure `internal`, and the api stopped serving cert.ensure though
 * the certs part mounted the current, public one.
 */
const common = {
    domain: 'stalecopy',
    action: 'ensure',
    inputSchema: z.object({ domain: z.string() }),
    outputSchema: z.object({ ok: z.boolean() }),
    rest: { method: 'POST' as const, path: '/stalecopy/ensure' },
    filePath: 'src/__tests__/core/StaleContractCopy.spec.ts',
    concurrency: 'on-demand' as const,
    permissions: [],
    print: defaultPrint,
};

describe('a stale imported copy of a contract, and the mounted one', () => {
    defineContract({ ...common, description: 'stale', visibility: 'internal' });
    const current = defineContract({ ...common, description: 'current', visibility: 'public' });
    let app: MeshApp;

    beforeAll(async () => {
        app = new MeshApp({ nodeID: 'stalecopy-node', namespace: 'test', logger: new Logger(LogLevel.WARN) });
        app.use(new RegistryModule({ preferLocal: true, implementation: PlacementRegistry }));
        app.use(new BrokerModule());
        await app.start();
    });

    afterAll(async () => {
        await app.stop();
    });

    it('the first import still decides while nothing is mounted', () => {
        expect(globalContractRegistry.get('stalecopy.ensure')?.description).toBe('stale');
        expect(globalContractRegistry.isMounted('stalecopy.ensure')).toBe(false);
    });

    it('mounting the handler puts its own definition in, and a later import cannot take it back', () => {
        app.getProvider<IServiceBroker>('broker').registerContract(current, async () => ({ ok: true }));

        expect(globalContractRegistry.get('stalecopy.ensure')?.visibility).toBe('public');
        expect(globalContractRegistry.get('stalecopy.ensure')?.description).toBe('current');
        expect(globalContractRegistry.isMounted('stalecopy.ensure')).toBe(true);

        defineContract({ ...common, description: 'stale again', visibility: 'internal' });
        expect(globalContractRegistry.get('stalecopy.ensure')?.description).toBe('current');
    });
});
