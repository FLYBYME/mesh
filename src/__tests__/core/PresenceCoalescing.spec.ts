import { z } from 'zod';
import { MeshOrchestrator, PRESENCE_COALESCE_MS } from '../../core/MeshOrchestrator.js';
import { PlacementRegistry } from '../../core/PlacementRegistry.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import type { IMeshNetworkNode } from '../../interfaces/IMeshNetwork.js';
import { defineContract } from '../../interfaces/IToolContract.js';

/**
 * A part of ~200 contracts loading or unloading changed the local registry ~200 times, and each
 * change broadcast the node's whole presence to every peer: ~42 ms apiece, 8 s with the event loop
 * held at both ends of every redeploy (surfdns-compute on surf, 2026-09-26).
 */
describe('presence broadcasts are coalesced', () => {
    const logger = new Logger(LogLevel.ERROR);
    let registry: PlacementRegistry;
    let presences: number;
    let orchestrator: MeshOrchestrator;

    beforeEach(() => {
        registry = new PlacementRegistry(logger, { localNodeID: 'local' });
        const local = registry.getNode('local');
        if (local === undefined) throw new Error('no local node');
        local.addresses = ['ws://127.0.0.1:6595'];
        registry.registerNode(local);
        presences = 0;
        const node = {
            nodeID: 'local', namespace: 'default', logger, registry,
            send: async (_target: string, topic: string): Promise<void> => { if (topic === '$node.presence') presences += 1; },
            publish: async (): Promise<void> => undefined,
        } as unknown as IMeshNetworkNode;
        orchestrator = new MeshOrchestrator(node);
    });

    afterEach(async () => {
        await orchestrator.stop();
        await registry.stop();
    });

    const settle = async (): Promise<void> => new Promise((r) => setTimeout(r, PRESENCE_COALESCE_MS * 3));

    it('sends one presence for a part registering 200 contracts', async () => {
        for (let i = 0; i < 200; i++) {
            registry.registerContract(defineContract({
                domain: 'burst', action: `a${i}`, description: 'x', inputSchema: z.object({}), outputSchema: z.object({}),
                rest: { method: 'POST', path: `/burst/a${i}` }, visibility: 'internal', filePath: 'x', concurrency: 'on-demand', permissions: [],
            }));
        }
        expect(presences).toBe(0); // not one per contract, synchronously
        await settle();
        expect(presences).toBe(1);
    });

    it('and one for unloading them', async () => {
        for (let i = 0; i < 50; i++) {
            registry.registerContract(defineContract({
                domain: 'gone', action: `a${i}`, description: 'x', inputSchema: z.object({}), outputSchema: z.object({}),
                rest: { method: 'POST', path: `/gone/a${i}` }, visibility: 'internal', filePath: 'x', concurrency: 'on-demand', permissions: [],
            }));
        }
        await settle();
        presences = 0;
        for (let i = 0; i < 50; i++) registry.unregisterContract(`gone.a${i}`);
        await settle();
        expect(presences).toBe(1);
    });

    it('still sends each separate change, once the burst is over', async () => {
        registry.emit('local:changed');
        await settle();
        registry.emit('local:changed');
        await settle();
        expect(presences).toBe(2);
    });
});
