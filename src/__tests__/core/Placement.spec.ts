import { z } from 'zod';
import { MeshApp } from '../../core/MeshApp.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { PlacementRegistry } from '../../core/PlacementRegistry.js';
import { ServiceBroker } from '../../core/ServiceBroker.js';
import { defineContract, defaultPrint } from '../../interfaces/IToolContract.js';
import type { IServiceBroker } from '../../interfaces/IServiceBroker.js';
import type { IPlacement } from '../../interfaces/IPlacement.js';

/**
 * The on-demand half of placement: a call for a contract nothing serves gets one chance to be
 * loaded before it fails.
 *
 * What makes this worth testing carefully is not the happy path but the ways it can go wrong --
 * stampeding on a cold start, recursing when the loader itself needs an unplaced tool, or turning
 * a clean "nobody serves this" into a hang. Each has its own test below.
 */

const placedContract = defineContract({
    domain: 'placed',
    action: 'work',
    description: 'A contract nothing serves until placement loads it.',
    inputSchema: z.object({ n: z.number() }),
    outputSchema: z.object({ doubled: z.number() }),
    rest: { method: 'POST', path: '/placed/work' },
    filePath: 'src/__tests__/core/handlers/placed.ts',
    concurrency: 'on-demand',
    permissions: [],
    print: defaultPrint,
});

declare global {
    interface IServiceToolRegistry {
        'placed.work': { params: { n: number }; returns: { doubled: number } };
    }
}

describe('placement: loading a contract on first call', () => {
    let app: MeshApp;
    let broker: ServiceBroker;

    beforeEach(async () => {
        app = new MeshApp({ nodeID: 'placement-node', namespace: 'test', logger: new Logger(LogLevel.ERROR) });
        app.use(new RegistryModule({ preferLocal: true, implementation: PlacementRegistry }));
        app.use(new BrokerModule());
        await app.start();
        broker = app.getProvider<IServiceBroker>('broker') as ServiceBroker;
    });

    afterEach(async () => {
        await app.stop();
    });

    /** A provider that mounts the contract locally, exactly as a real loader would. */
    function loaderPlacement(onPlace?: () => void): IPlacement {
        return {
            place: async (toolName) => {
                onPlace?.();
                if (toolName !== 'placed.work') return undefined;
                broker.registerContract(placedContract, async (params) => ({ doubled: params.n * 2 }));
                return broker.nodeID;
            },
        };
    }

    it('fails as before when no provider is installed', async () => {
        await expect(broker.call('placed.work', { n: 1 })).rejects.toThrow(/not found|advertis/i);
    });

    it('loads the contract and answers the call that triggered it', async () => {
        broker.setPlacement(loaderPlacement());

        const result = await broker.call('placed.work', { n: 21 });
        expect(result.doubled).toBe(42);
    });

    it('does not place again once the contract is mounted', async () => {
        let placements = 0;
        broker.setPlacement(loaderPlacement(() => { placements += 1; }));

        await broker.call('placed.work', { n: 1 });
        await broker.call('placed.work', { n: 2 });
        await broker.call('placed.work', { n: 3 });

        expect(placements).toBe(1);
    });

    it('places once for a burst of concurrent calls, and answers all of them', async () => {
        // The cold-start case: twenty callers arrive before anything is mounted. Without
        // deduplication this is twenty loads, or nineteen failures while the first is in flight.
        let placements = 0;
        broker.setPlacement({
            place: async (toolName) => {
                placements += 1;
                await new Promise((r) => { setTimeout(r, 25); });
                if (toolName !== 'placed.work') return undefined;
                broker.registerContract(placedContract, async (params) => ({ doubled: params.n * 2 }));
                return broker.nodeID;
            },
        });

        const results = await Promise.all(
            Array.from({ length: 20 }, (_, i) => broker.call('placed.work', { n: i })),
        );

        expect(placements).toBe(1);
        expect(results.map((r) => r.doubled)).toEqual(Array.from({ length: 20 }, (_, i) => i * 2));
    });

    it('lets the call fail normally when the provider declines', async () => {
        broker.setPlacement({ place: async () => undefined });

        await expect(broker.call('placed.work', { n: 1 })).rejects.toThrow(/not found|advertis/i);
    });

    it('lets the call fail normally when the provider throws, rather than surfacing its error', async () => {
        // A broken loader shouldn't change what the caller sees: nobody serves the tool either way.
        broker.setPlacement({
            place: async () => { throw new Error('artifact store unreachable'); },
        });

        await expect(broker.call('placed.work', { n: 1 })).rejects.toThrow(/not found|advertis/i);
    });

    it('refuses to re-enter for the same tool instead of deadlocking', async () => {
        // A provider that calls the very tool it was asked to place. Awaiting the in-flight
        // attempt here would be awaiting ourselves, so the inner call proceeds unplaced and fails
        // -- bad, but finite, and it points at the provider.
        broker.setPlacement({
            place: async () => {
                await expect(broker.call('placed.work', { n: 1 })).rejects.toThrow(/not found|advertis/i);
                return undefined;
            },
        });

        await expect(broker.call('placed.work', { n: 1 })).rejects.toThrow(/not found|advertis/i);
    });

    it('hands the provider the contract when the registry knows it', async () => {
        let seen: string | undefined;
        broker.setPlacement({
            place: async (toolName, contract) => {
                seen = contract?.filePath;
                if (toolName !== 'placed.work') return undefined;
                broker.registerContract(placedContract, async (params) => ({ doubled: params.n * 2 }));
                return broker.nodeID;
            },
        });

        await broker.call('placed.work', { n: 1 });
        // filePath is what a real provider needs to find the code.
        expect(seen).toBe('src/__tests__/core/handlers/placed.ts');
    });

    it('does not attempt placement when the caller named a node', async () => {
        let placements = 0;
        broker.setPlacement(loaderPlacement(() => { placements += 1; }));

        // An explicit nodeID is a routing decision the caller already made.
        await expect(
            broker.call('placed.work', { n: 1 }, { nodeID: 'some-other-node' }),
        ).rejects.toThrow();
        expect(placements).toBe(0);
    });
});
