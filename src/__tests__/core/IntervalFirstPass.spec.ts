import { z } from 'zod';
import { MeshApp } from '../../core/MeshApp.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { PlacementRegistry } from '../../core/PlacementRegistry.js';
import { defineContract, defaultPrint } from '../../interfaces/IToolContract.js';
import type { IServiceBroker } from '../../interfaces/IServiceBroker.js';

/**
 * An interval contract runs its first pass right after it loads, not one whole interval later --
 * unless it is leaderScoped, whose early pass could run on every node before the leader is known.
 * serve.queue.tick (a 60 s safety net, woken by events in between) is why (2026-09-30).
 */
const common = {
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    filePath: 'src/__tests__/core/IntervalFirstPass.spec.ts',
    concurrency: 'interval' as const,
    intervalMs: 60_000,
    permissions: [],
    print: defaultPrint,
};
const slow = defineContract({ ...common, domain: 'firstpass', action: 'slow', description: 'A minute between passes' });
const single = defineContract({ ...common, domain: 'firstpass', action: 'single', description: 'A cluster singleton', leaderScoped: true });

describe('an interval contract\'s first pass', () => {
    let app: MeshApp;

    beforeAll(async () => {
        app = new MeshApp({ nodeID: 'firstpass-node', namespace: 'test', logger: new Logger(LogLevel.WARN) });
        app.use(new RegistryModule({ preferLocal: true, implementation: PlacementRegistry }));
        app.use(new BrokerModule());
        await app.start();
    });

    afterAll(async () => {
        await app.stop();
    });

    it('runs within a second of loading, a minute before its timer', async () => {
        const ran: string[] = [];
        const broker = app.getProvider<IServiceBroker>('broker');
        broker.registerContract(slow, async () => { ran.push('slow'); return {}; });
        broker.registerContract(single, async () => { ran.push('single'); return {}; });

        await new Promise((r) => setTimeout(r, 1500));
        expect(ran).toEqual(['slow']);
    });
});
