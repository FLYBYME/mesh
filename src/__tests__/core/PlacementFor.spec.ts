import { Registry } from '../../core/Registry.js';
import { PlacementRegistry } from '../../core/PlacementRegistry.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import type { IServiceRegistry } from '../../interfaces/IServiceRegistry.js';

/**
 * `placementFor` vs `leaderFor`: where to *put* something, versus which of the nodes already
 * running it should lead.
 *
 * The distinction is the candidate set, and missing it is a real dead end: a supervisor asking
 * `leaderFor` where to start a service that nobody is running gets `undefined`, correctly and
 * uselessly, because no node advertises it yet. That is precisely the case placement exists for.
 */
describe.each([
    ['Registry', (logger: Logger, nodeID: string) => new Registry(logger, { localNodeID: nodeID }) as IServiceRegistry],
    ['PlacementRegistry', (logger: Logger, nodeID: string) => new PlacementRegistry(logger, { localNodeID: nodeID }) as IServiceRegistry],
])('%s.placementFor', (_name, make) => {
    const logger = new Logger(LogLevel.ERROR);

    const nodeInfo = (nodeID: string, services: string[] = [], available = true): never => ({
        nodeID,
        type: 'node',
        namespace: 'default',
        addresses: [],
        available,
        timestamp: Date.now(),
        nodeSeq: 1,
        hostname: 'localhost',
        services: services.map((name) => ({ name, tools: [] })),
        trustLevel: 'internal',
        metadata: {},
        capabilities: { transports: ['ws'], features: [] },
        pid: process.pid,
        cpu: 0,
        activeRequests: 0,
        healthScore: 1.0,
    }) as never;

    function withNodes(registry: IServiceRegistry, nodes: { nodeID: string; services?: string[] }[]): void {
        for (const node of nodes) {
            registry.registerNode(nodeInfo(node.nodeID, node.services ?? []));
        }
    }

    it('picks a node for something nobody is running, where leaderFor cannot', () => {
        const registry = make(logger, 'n1');
        withNodes(registry, [{ nodeID: 'n1' }, { nodeID: 'n2' }, { nodeID: 'n3' }]);

        // Nothing advertises it, so there is no leader -- correctly, and uselessly for placement.
        expect(registry.leaderFor('acme/worker')).toBeUndefined();

        const placed = registry.placementFor('acme/worker');
        expect(placed).toBeDefined();
        expect(['n1', 'n2', 'n3']).toContain(placed?.nodeID);
    });

    it('is deterministic, so every node reaches the same answer without an election', () => {
        const fromN1 = make(logger, 'n1');
        const fromN3 = make(logger, 'n3');
        const nodes = [{ nodeID: 'n1' }, { nodeID: 'n2' }, { nodeID: 'n3' }];
        withNodes(fromN1, nodes);
        withNodes(fromN3, nodes);

        expect(fromN3.placementFor('acme/worker')?.nodeID).toBe(fromN1.placementFor('acme/worker')?.nodeID);
    });

    it('is stable across repeated calls -- a reconcile loop must not oscillate', () => {
        const registry = make(logger, 'n1');
        withNodes(registry, [{ nodeID: 'n1' }, { nodeID: 'n2' }, { nodeID: 'n3' }]);

        const first = registry.placementFor('acme/worker')?.nodeID;
        for (let i = 0; i < 5; i++) {
            expect(registry.placementFor('acme/worker')?.nodeID).toBe(first);
        }
    });

    it('spreads different keys across nodes rather than piling them on one', () => {
        const registry = make(logger, 'n1');
        withNodes(registry, [{ nodeID: 'node-alpha' }, { nodeID: 'node-beta' }, { nodeID: 'node-gamma' }]);

        const chosen = new Set<string | undefined>();
        for (const key of ['acme/a', 'acme/b', 'acme/c', 'acme/d', 'acme/e', 'acme/f', 'acme/g', 'acme/h']) {
            chosen.add(registry.placementFor(key)?.nodeID);
        }
        expect(chosen.size).toBeGreaterThan(1);
    });

    it('ignores unavailable nodes, so a dead node is never chosen', () => {
        const registry = make(logger, 'n1');
        withNodes(registry, [{ nodeID: 'n1' }, { nodeID: 'n2' }]);

        const before = registry.placementFor('acme/worker')?.nodeID;
        expect(before).toBeDefined();

        registry.registerNode(nodeInfo(before!, [], false));

        const after = registry.placementFor('acme/worker')?.nodeID;
        expect(after).toBeDefined();
        expect(after).not.toBe(before);
    });

    it('falls back to the local node, which a registry always knows about', () => {
        // A registry registers its own node, so there is always somewhere to put something --
        // a single-node cluster supervises itself rather than reporting nowhere to go.
        const registry = make(logger, 'n1');
        expect(registry.placementFor('acme/worker')?.nodeID).toBe('n1');
    });

    it('still lets leaderFor pick among nodes that do run it', () => {
        // Remote nodes, not the local one: a registry maintains its own entry from its real
        // mounted services, so a hand-written one for `n1` would be overwritten.
        const registry = make(logger, 'n1');
        withNodes(registry, [
            { nodeID: 'n2', services: ['serve.queue'] },
            { nodeID: 'n3' },
        ]);

        expect(registry.leaderFor('serve.queue')?.nodeID).toBe('n2');
    });
});
