import { z } from 'zod';
import { MeshApp } from '../../core/MeshApp.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { PlacementRegistry } from '../../core/PlacementRegistry.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { defineContract, defaultPrint } from '../../interfaces/IToolContract.js';
import type { IServiceBroker } from '../../interfaces/IServiceBroker.js';

/**
 * A handler that fails after its call has already timed out: the caller has its TimeoutError, and
 * the late failure must not become an unhandled rejection -- one of those ends a Node process. It
 * does not: Promise.race subscribes to the handler's promise too. Kept as a guard, written while
 * looking for a stray "client was closed" error at the end of mesh-serve's test run (2026-10-07).
 */
const slowThenFail = defineContract({
    domain: 'late', action: 'fail', description: 'Fails after 150 ms',
    inputSchema: z.object({}), outputSchema: z.object({}),
    filePath: 'src/__tests__/core/LateFailure.spec.ts', concurrency: 'on-demand', permissions: [], print: defaultPrint,
});

declare global {
    interface IServiceToolRegistry {
        'late.fail': { params: Record<string, never>; returns: Record<string, never> };
    }
}

describe('a handler failing after its timeout', () => {
    let app: MeshApp;
    let broker: IServiceBroker;
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };

    beforeAll(async () => {
        app = new MeshApp({ nodeID: 'late-node', logger: new Logger(LogLevel.ERROR) });
        app.use(new RegistryModule({ implementation: PlacementRegistry }));
        app.use(new BrokerModule());
        await app.start();
        broker = app.getProvider<IServiceBroker>('broker');
        broker.registerContract(slowThenFail, async () => {
            await new Promise((r) => setTimeout(r, 150));
            throw new Error('the database client was closed');
        });
        process.on('unhandledRejection', onUnhandled);
    });

    afterAll(async () => {
        process.off('unhandledRejection', onUnhandled);
        await app.stop();
    });

    it('gives the caller its timeout, and leaves nothing unhandled when the handler fails later', async () => {
        await expect(broker.call('late.fail', {}, { timeout: 30 })).rejects.toMatchObject({ code: 'TIMEOUT' });

        await new Promise((r) => setTimeout(r, 300));

        expect(unhandled).toEqual([]);
    });
});
