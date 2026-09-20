import { PlacementRegistry } from '../../core/PlacementRegistry.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { demoContracts } from '../../examples/demo/demo.contract.js';
import type { NodeInfo } from '../../interfaces/IMeshNetwork.js';
import { idToBigInt, xorDistance } from '../../core/KademliaRoutingTable.js';

/**
 * Mirrors Registry.spec.ts's own coverage for everything genuinely module-agnostic (node tracking,
 * heartbeat, findNodesForTool, selectNode, leaderFor, pruning-adjacent state) -- proving
 * PlacementRegistry is a real drop-in for Registry, not a divergent reimplementation. Registration
 * is exercised the same way (via `registerContract` -- this
 * class doesn't split the two). The new coverage is `registerContract()`/`unregisterContract()`
 * themselves, and that a module and standalone contracts can share one domain without clobbering
 * each other.
 */
describe('PlacementRegistry', () => {
    let registry: PlacementRegistry;
    const localNodeID = 'placement-test-node';

    const createNodeInfo = (nodeID: string, services: { name: string; tools?: Record<string, unknown> }[] = []): NodeInfo => ({
        nodeID,
        type: 'node',
        namespace: 'default',
        addresses: [],
        available: true,
        timestamp: Date.now(),
        nodeSeq: 1,
        hostname: 'localhost',
        services: services as any,
        trustLevel: 'internal',
        metadata: {},
        capabilities: { transports: ['ws'], features: [] },
        pid: process.pid,
        cpu: 0,
        activeRequests: 0,
        healthScore: 1.0
    });

    beforeEach(() => {
        registry = new PlacementRegistry(new Logger(LogLevel.WARN), { localNodeID, preferLocal: true });
    });

    afterEach(async () => {
        await registry.stop();
    });

    describe('registerNode / getNode / getNodes', () => {
        it('should auto-register the local node on construction', () => {
            const nodes = registry.getNodes();
            expect(nodes.length).toBeGreaterThanOrEqual(1);
            const local = registry.getNode(localNodeID);
            expect(local).toBeDefined();
            expect(local!.nodeID).toBe(localNodeID);
        });

        it('should register a remote node', () => {
            registry.registerNode(createNodeInfo('remote-1'));
            const node = registry.getNode('remote-1');
            expect(node).toBeDefined();
            expect(node!.nodeID).toBe('remote-1');
        });
    });

    describe('unregisterNode / getAvailableNodes', () => {
        it('should remove a node', () => {
            registry.registerNode(createNodeInfo('removable'));
            expect(registry.getNode('removable')).toBeDefined();

            registry.unregisterNode('removable');
            expect(registry.getNode('removable')).toBeUndefined();
        });
    });

    describe('heartbeat()', () => {
        it('should update cpu and activeRequests', () => {
            registry.registerNode(createNodeInfo('hb-node'));
            registry.heartbeat('hb-node', { cpu: 50, activeRequests: 10 });

            const node = registry.getNode('hb-node');
            expect(node!.cpu).toBe(50);
            expect(node!.activeRequests).toBe(10);
        });
    });

    describe('findNodesForTool()', () => {
        it('should find nodes that advertise a tool', () => {
            registry.registerNode(createNodeInfo('tool-node-1', [
                { name: 'math', tools: { 'math.add': { name: 'math.add' } } }
            ]));

            const mathNodes = registry.findNodesForTool('math.add');
            expect(mathNodes).toHaveLength(1);
            expect(mathNodes[0].nodeID).toBe('tool-node-1');
        });
    });

    // ─── the native, per-contract registration path ──────────────────────────

    describe('registerContract()', () => {
        it('registers one contract with no module involved at all', () => {
            const [contract] = demoContracts;

            registry.registerContract(contract);

            const nodes = registry.findNodesForTool('demo.hello');
            expect(nodes.some((n) => n.nodeID === localNodeID)).toBe(true);
            expect(registry.getTool('demo.hello')).toBe(contract);
        });

        it('merges multiple standalone contracts sharing one domain, rather than replacing the domain entry', () => {
            const contracts = demoContracts;
            expect(contracts.length).toBeGreaterThanOrEqual(2);

            for (const contract of contracts) {
                registry.registerContract(contract);
            }

            for (const contract of contracts) {
                const key = `${contract.domain}.${contract.action}`;
                expect(registry.findNodesForTool(key).some((n) => n.nodeID === localNodeID)).toBe(true);
            }
        });

        it('keeps every contract of a domain addressable when they are registered one at a time', () => {
            // Registering contracts individually must not have each one replace the domain's entry
            // -- the failure this guards is a domain that only ever advertises whichever contract
            // registered last.
            for (const contract of demoContracts) {
                registry.registerContract(contract);
            }

            for (const contract of demoContracts) {
                const key = `${contract.domain}.${contract.action}`;
                expect(registry.getTool(key)).toBe(contract);
            }
        });
    });

    describe('unregisterContract()', () => {
        it('removes exactly one contract, leaving sibling contracts under the same domain intact', () => {
            const contracts = demoContracts;
            for (const contract of contracts) {
                registry.registerContract(contract);
            }

            const [toRemove, ...remaining] = contracts;
            const removeKey = `${toRemove.domain}.${toRemove.action}`;
            registry.unregisterContract(removeKey);

            expect(registry.findNodesForTool(removeKey)).toHaveLength(0);
            expect(registry.getTool(removeKey)).toBeUndefined();

            for (const contract of remaining) {
                const key = `${contract.domain}.${contract.action}`;
                expect(registry.findNodesForTool(key).some((n) => n.nodeID === localNodeID)).toBe(true);
            }
        });
    });

    // ─── selectNode ─────────────────────────────────────────────────────────

    describe('selectNode()', () => {
        it('should prefer local node when preferLocal is true', () => {
            for (const contract of demoContracts) registry.registerContract(contract);

            registry.registerNode(createNodeInfo('remote-demo', [
                { name: 'demo', tools: { 'demo.hello': { name: 'demo.hello' } } }
            ]));

            const selected = registry.selectNode('demo.hello', { toolName: 'demo.hello', params: {} });
            expect(selected).toBeDefined();
            expect(selected!.nodeID).toBe(localNodeID);
        });
    });

    // ─── leaderFor ──────────────────────────────────────────────────────────

    describe('leaderFor()', () => {
        it('returns undefined when nothing offers the domain', () => {
            expect(registry.leaderFor('infer.provider')).toBeUndefined();
        });

        it('is deterministic: repeated calls over the same state agree', () => {
            registry.registerNode(createNodeInfo('infer-node-1', [{ name: 'infer.provider' }]));
            registry.registerNode(createNodeInfo('infer-node-2', [{ name: 'infer.provider' }]));
            registry.registerNode(createNodeInfo('infer-node-3', [{ name: 'infer.provider' }]));

            const first = registry.leaderFor('infer.provider');
            for (let i = 0; i < 10; i++) {
                expect(registry.leaderFor('infer.provider')?.nodeID).toBe(first?.nodeID);
            }
        });

        it('picks a different leader automatically once the current one is removed', () => {
            registry.registerNode(createNodeInfo('infer-node-1', [{ name: 'infer.provider' }]));
            registry.registerNode(createNodeInfo('infer-node-2', [{ name: 'infer.provider' }]));

            const before = registry.leaderFor('infer.provider');
            expect(before).toBeDefined();

            registry.unregisterNode(before!.nodeID);

            const after = registry.leaderFor('infer.provider');
            expect(after).toBeDefined();
            expect(after!.nodeID).not.toBe(before!.nodeID);
        });

        it('picks the candidate closest to hash(domain) by XOR distance', () => {
            const domain = 'infer.provider';
            registry.registerNode(createNodeInfo('aaa', [{ name: domain }]));
            registry.registerNode(createNodeInfo('bbb', [{ name: domain }]));
            registry.registerNode(createNodeInfo('ccc', [{ name: domain }]));

            const target = idToBigInt(domain);
            const expected = [localNodeID, 'aaa', 'bbb', 'ccc']
                .map((nodeID) => ({ nodeID, distance: xorDistance(target, idToBigInt(nodeID)) }))
                .sort((a, b) => (a.distance < b.distance ? -1 : a.distance > b.distance ? 1 : 0))[0];

            const candidateExpected = expected.nodeID === localNodeID
                ? [localNodeID, 'aaa', 'bbb', 'ccc']
                    .filter((id) => id !== localNodeID)
                    .map((nodeID) => ({ nodeID, distance: xorDistance(target, idToBigInt(nodeID)) }))
                    .sort((a, b) => (a.distance < b.distance ? -1 : a.distance > b.distance ? 1 : 0))[0]
                : expected;

            expect(registry.leaderFor(domain)?.nodeID).toBe(candidateExpected.nodeID);
        });
    });

    describe('waitForTool()', () => {
        it('should resolve immediately if tool exists', async () => {
            registry.registerNode(createNodeInfo('tool-wait-node', [
                { name: 'math', tools: { 'math.add': { name: 'math.add' } } }
            ]));
            await registry.waitForTool('math.add', 1000);
        });

        it('should timeout if tool never appears', async () => {
            await expect(
                registry.waitForTool('never.exists', 500)
            ).rejects.toThrow('Timeout');
        });
    });
});
