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
 * `replace: true` stops what it replaces: a long-running contract's signal aborts, an interval
 * contract's old timer stops ticking (CHECKLIST 1, "Calls"). Before, the old timer ran on beside
 * the new one's interval and the new handler got the old registration's signal.
 */
const common = {
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    filePath: 'src/__tests__/core/ReplaceStopsOld.spec.ts',
    permissions: [],
    print: defaultPrint,
};
const listener = defineContract({ ...common, domain: 'replaceold', action: 'listen', description: 'Holds a resource until stopped', concurrency: 'long-running' });
const fast = defineContract({ ...common, domain: 'replaceold', action: 'tick', description: 'Every 50 ms', concurrency: 'interval', intervalMs: 50 });
const slow = defineContract({ ...fast, description: 'Every minute', intervalMs: 60_000 });

describe('replace: true stops what it replaces', () => {
    let app: MeshApp;
    let broker: IServiceBroker;

    beforeAll(async () => {
        app = new MeshApp({ nodeID: 'replaceold-node', namespace: 'test', logger: new Logger(LogLevel.WARN) });
        app.use(new RegistryModule({ preferLocal: true, implementation: PlacementRegistry }));
        app.use(new BrokerModule());
        await app.start();
        broker = app.getProvider<IServiceBroker>('broker');
    });

    afterAll(async () => {
        await app.stop();
    });

    it('a long-running contract: the old signal aborts, the new handler gets a live one', async () => {
        const signals: AbortSignal[] = [];
        const handler = async (_input: Record<string, never>, ctx: { signal: AbortSignal }) => { signals.push(ctx.signal); return {}; };

        broker.registerContract(listener, handler);
        await broker.call('replaceold.listen', {});
        broker.registerContract(listener, handler, { replace: true });
        await broker.call('replaceold.listen', {});

        expect(signals).toHaveLength(2);
        expect(signals[0]?.aborted).toBe(true);
        expect(signals[1]?.aborted).toBe(false);
    });

    it('an interval contract: the old timer stops, the new interval holds', async () => {
        let ticks = 0;
        broker.registerContract(fast, async () => { ticks += 1; return {}; });
        await new Promise((r) => setTimeout(r, 300));
        expect(ticks).toBeGreaterThan(1);

        broker.registerContract(slow, async () => { ticks += 1; return {}; }, { replace: true });
        await new Promise((r) => setTimeout(r, 100));
        const after = ticks;
        await new Promise((r) => setTimeout(r, 400));

        expect(ticks).toBe(after);
    });
});
