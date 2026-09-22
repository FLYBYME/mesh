import { PlacementRegistry } from '../../core/PlacementRegistry.js';
import { Registry } from '../../core/Registry.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import type { IServiceRegistry } from '../../interfaces/IServiceRegistry.js';
import type { NodeInfo } from '../../interfaces/IMeshNetwork.js';

/**
 * Found live, after the metadata-backfill fix (mesh v4.2.3, see RegisterNodeMetadataBackfill.spec)
 * still wasn't enough for one specific peer: it still showed {} labels no matter how many times it
 * reconnected. nodeSeq is not a boot generation -- it is just how many contracts a node has
 * registered so far in its *current* process, and it resets low on every restart. A relay that is
 * still holding a peer's nodeSeq from a *previous*, longer-lived boot (more contracts registered by
 * then, so a higher count) permanently outranks every real update from that peer after it restarts
 * with a fresh, lower nodeSeq -- not just metadata, anything -- because the very first guard
 * (`existing.nodeSeq > incoming.nodeSeq -> return`) exits before the equal-nodeSeq backfill logic
 * even runs. Confirmed live with debug logging on a real node: the stale relay's registration
 * ("Node ns1 registered/updated") logged 1.4s *before* the peer's own direct presence connection.
 *
 * A `trusted` flag (handlePresence-only, never PEX) closes that specific ordering, but not the
 * reverse: a stale relay arriving *after* a correct trusted registration can still fully replace it,
 * because "incoming nodeSeq is numerically higher" already won outright, trusted or not -- and a
 * stale relay's cached nodeSeq from a peer's previous, longer-lived boot really can be higher than
 * that peer's own fresh, low nodeSeq after restarting. nodeSeq alone cannot tell "genuinely newer,
 * from the current boot" apart from "stale, from a previous boot" when both are numerically higher
 * than what's on record. `bootedAt` (already part of NodeInfo, already relayed faithfully through
 * both presence and PEX) can: it is set once, at process start, and never recomputed, so it settles
 * which of two records is newer independently of how many contracts either boot has registered.
 */
describe.each([
    ['PlacementRegistry', PlacementRegistry],
    ['Registry', Registry],
])('%s.registerNode: a real boot generation beats a stale relay', (_name, RegistryClass) => {
    let registry: IServiceRegistry;

    beforeEach(() => {
        registry = new RegistryClass(new Logger(LogLevel.ERROR), { localNodeID: 'local' });
    });

    afterEach(async () => {
        await registry.stop();
    });

    const OLD_BOOT = 1_000_000;
    const NEW_BOOT = 2_000_000;

    const peerAt = (nodeSeq: number, metadata: Record<string, string>, bootedAt: number): NodeInfo => ({
        nodeID: 'sibling-spoke',
        type: 'node',
        namespace: 'default',
        addresses: ['ws://203.0.113.9:6005'],
        available: true,
        timestamp: Date.now(),
        nodeSeq,
        bootedAt,
        hostname: 'sibling',
        services: [],
        trustLevel: 'internal',
        metadata,
        capabilities: { transports: ['ws'], features: [] },
        pid: 1,
    } as NodeInfo);

    it('a fresh restart at a lower nodeSeq still wins, untrusted, once its bootedAt is newer', () => {
        // A relay's stale, pre-restart copy: nodeSeq 40 (that boot ran long, registered lots of
        // contracts), no labels captured.
        registry.registerNode(peerAt(40, {}, OLD_BOOT));
        expect(registry.getNode('sibling-spoke')?.nodeSeq).toBe(40);

        // The peer's own genuine presence after restarting: fewer contracts loaded so far (nodeSeq
        // 3), real labels, a newer bootedAt. Not even marked trusted -- bootedAt alone settles it.
        registry.registerNode(peerAt(3, { role: 'dns', region: 'lon' }, NEW_BOOT));

        expect(registry.getNode('sibling-spoke')?.metadata).toEqual({ role: 'dns', region: 'lon' });
        expect(registry.getNode('sibling-spoke')?.nodeSeq).toBe(3);
        expect(registry.getNode('sibling-spoke')?.bootedAt).toBe(NEW_BOOT);
    });

    it('a stale relay of the old boot arriving after cannot erase the new boot, even at a higher nodeSeq', () => {
        registry.registerNode(peerAt(3, { role: 'dns', region: 'lon' }, NEW_BOOT));

        // A relay, still stuck on this peer's old boot (higher nodeSeq, older bootedAt), shows up
        // later -- the exact ordering that broke the nodeSeq-only, trusted-only version of this fix.
        registry.registerNode(peerAt(40, {}, OLD_BOOT));

        expect(registry.getNode('sibling-spoke')?.metadata).toEqual({ role: 'dns', region: 'lon' });
        expect(registry.getNode('sibling-spoke')?.bootedAt).toBe(NEW_BOOT);
    });

    it('still falls back to trusted + nodeSeq when bootedAt is missing on one side (mixed-version peer)', () => {
        // Pre-this-fix peer, or a synthetic PEX entry, with no bootedAt at all.
        registry.registerNode({ ...peerAt(40, {}, NEW_BOOT), bootedAt: undefined });
        expect(registry.getNode('sibling-spoke')?.metadata).toEqual({});

        // Same nodeSeq, no bootedAt to compare either -- falls back to the trusted backfill path.
        registry.registerNode({ ...peerAt(40, { role: 'dns', region: 'lon' }, NEW_BOOT), bootedAt: undefined }, true);

        expect(registry.getNode('sibling-spoke')?.metadata).toEqual({ role: 'dns', region: 'lon' });
    });
});
