import { PlacementRegistry } from '../../core/PlacementRegistry.js';
import { Registry } from '../../core/Registry.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import type { IServiceRegistry } from '../../interfaces/IServiceRegistry.js';
import type { NodeInfo } from '../../interfaces/IMeshNetwork.js';

/**
 * Fixing the PEX projection (v4.2.2, see PexMetadata.spec.ts) closed the loudest path to a peer's
 * labels showing up as {} forever, but not the underlying one: registerNode's equal-nodeSeq fast
 * path only ever refreshed available/cpu/activeRequests, never metadata. So the very first
 * registration for a given nodeSeq still permanently decided a peer's labels -- and a node's first
 * registration is a genuine race between its own direct presence (always correct) and second-hand
 * PEX through an intermediary (which can itself be relaying its own stale, pre-reconnect copy).
 * Found live, immediately after the PEX fix shipped: three nodes cycling through Docker restarts
 * within minutes of each other, and two spokes reconnecting to the hub at close to the same moment,
 * still landed both of them at {} on the hub. A node's labels are fixed for its whole lifetime
 * (set once, at `start`), so there's no staleness risk in a same-nodeSeq packet backfilling empty
 * metadata -- only in refusing to.
 */
describe.each([
    ['PlacementRegistry', PlacementRegistry],
    ['Registry', Registry],
])('%s.registerNode backfills empty metadata at the same nodeSeq', (_name, RegistryClass) => {
    let registry: IServiceRegistry;

    beforeEach(() => {
        registry = new RegistryClass(new Logger(LogLevel.ERROR), { localNodeID: 'local' });
    });

    afterEach(async () => {
        await registry.stop();
    });

    const peerAt = (nodeSeq: number, metadata: Record<string, string>): NodeInfo => ({
        nodeID: 'sibling-spoke',
        type: 'node',
        namespace: 'default',
        addresses: ['ws://203.0.113.9:6005'],
        available: true,
        timestamp: Date.now(),
        nodeSeq,
        hostname: 'sibling',
        services: [],
        trustLevel: 'internal',
        metadata,
        capabilities: { transports: ['ws'], features: [] },
        pid: 1,
    } as NodeInfo);

    it('takes real labels arriving after an empty first registration at the same nodeSeq', () => {
        registry.registerNode(peerAt(1, {}));
        expect(registry.getNode('sibling-spoke')?.metadata).toEqual({});

        registry.registerNode(peerAt(1, { role: 'dns', region: 'lon' }));

        expect(registry.getNode('sibling-spoke')?.metadata).toEqual({ role: 'dns', region: 'lon' });
    });

    it('does not let a later empty packet erase labels already learned', () => {
        registry.registerNode(peerAt(1, { role: 'dns', region: 'lon' }));
        registry.registerNode(peerAt(1, {}));

        expect(registry.getNode('sibling-spoke')?.metadata).toEqual({ role: 'dns', region: 'lon' });
    });
});
