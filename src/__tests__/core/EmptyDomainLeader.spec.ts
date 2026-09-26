import { z } from 'zod';
import { PlacementRegistry } from '../../core/PlacementRegistry.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { defineContract } from '../../interfaces/IToolContract.js';

/**
 * The build queue moved from edge1 to ns2 (2026-09-26): edge1 unloaded every serve.queue contract,
 * but PlacementRegistry kept an empty `serve.queue` entry in its presence, leaderFor still chose
 * edge1, and every leader-scoped serve.queue.claim went to a node answering "not found" -- no build
 * ran. (The older Registry already dropped an emptied domain; the two had drifted.)
 */
describe('a domain whose last contract is gone', () => {
    const logger = new Logger(LogLevel.ERROR);
    const contract = (action: string) => defineContract({
        domain: 'serve.queue', action, description: 'x', inputSchema: z.object({}), outputSchema: z.object({}),
        rest: { method: 'POST', path: `/queue/${action}` }, visibility: 'internal', filePath: 'x', concurrency: 'on-demand', permissions: [],
    });
    let registry: PlacementRegistry;

    beforeEach(() => { registry = new PlacementRegistry(logger, { localNodeID: 'edge1' }); });
    afterEach(async () => { await registry.stop(); });

    it('is dropped from this node\'s presence, and this node stops leading it', () => {
        registry.registerContract(contract('claim'));
        registry.registerContract(contract('tick'));
        expect(registry.leaderFor('serve.queue')?.nodeID).toBe('edge1');
        registry.unregisterContract('serve.queue.claim');
        expect(registry.leaderFor('serve.queue')?.nodeID).toBe('edge1'); // tick is still there
        registry.unregisterContract('serve.queue.tick');
        expect(registry.getNode('edge1')?.services.some((s) => s.name === 'serve.queue')).toBe(false);
        expect(registry.leaderFor('serve.queue')).toBeUndefined();
    });
});
