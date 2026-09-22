import { MeshOrchestrator } from '../../core/MeshOrchestrator.js';
import { PlacementRegistry } from '../../core/PlacementRegistry.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import type { IMeshNetworkNode, NodeInfo } from '../../interfaces/IMeshNetwork.js';

/**
 * A peer learned second-hand, via PEX gossip rather than its own direct presence, used to show up
 * with empty metadata forever -- gossipRound's peer projection (MeshOrchestrator.ts) listed the
 * fields worth forwarding by hand, and `metadata` (an operator's --labels set) wasn't one of them.
 * registerNode's equal-nodeSeq fast path only refreshes available/cpu/activeRequests, so once a peer
 * was first registered via PEX with no metadata, a later, correct $node.presence for that same
 * nodeSeq could never backfill it. Found live: a spoke connected only to the hub (never directly to
 * its sibling spoke) always saw the sibling's real --labels as {} in `serve.node.find`, while the hub
 * itself and any directly-connected peer saw them correctly. Same class of bug as the hostname drop
 * this same projection had already been fixed for once.
 */
describe('gossipRound forwards a known peer\'s labels, not just its identity', () => {
    let registry: PlacementRegistry;
    let published: Array<{ topic: string; payload: unknown }>;
    let orchestrator: MeshOrchestrator;

    beforeEach(() => {
        const logger = new Logger(LogLevel.ERROR);
        registry = new PlacementRegistry(logger, { localNodeID: 'local' });
        published = [];

        // Only one other node is available, so gossipRound's random target pick (Math.random() *
        // nodes.length) is deterministic -- there is only one non-local candidate to land on.
        const local = registry.getNode('local')!;
        local.available = false;
        registry.registerNode(local);

        registry.registerNode({
            nodeID: 'sibling-spoke',
            type: 'node',
            namespace: 'default',
            addresses: ['ws://203.0.113.9:6005'],
            available: true,
            timestamp: Date.now(),
            nodeSeq: 1,
            hostname: 'sibling',
            services: [],
            trustLevel: 'internal',
            metadata: { role: 'dns', region: 'lon' },
            capabilities: { transports: ['ws'], features: [] },
            pid: 1,
        } as NodeInfo);

        const node = {
            nodeID: 'local',
            namespace: 'default',
            logger,
            registry,
            send: async (): Promise<void> => undefined,
            publish: async (topic: string, payload: unknown): Promise<void> => {
                published.push({ topic, payload });
            },
        } as unknown as IMeshNetworkNode;
        orchestrator = new MeshOrchestrator(node);
    });

    afterEach(async () => {
        await registry.stop();
    });

    it('includes metadata in the peer list it gossips to others', async () => {
        await (orchestrator as unknown as { gossipRound(): Promise<void> }).gossipRound();

        expect(published).toHaveLength(1);
        expect(published[0]?.topic).toBe('$node.pex');

        const peers = (published[0]?.payload as { peers: Array<Partial<NodeInfo>> }).peers;
        const sibling = peers.find((p) => p.nodeID === 'sibling-spoke');
        expect(sibling?.metadata).toEqual({ role: 'dns', region: 'lon' });
    });

    it('lets a receiver register that peer with its real labels intact', async () => {
        await (orchestrator as unknown as { gossipRound(): Promise<void> }).gossipRound();
        const peers = (published[0]?.payload as { peers: Array<Partial<NodeInfo>> }).peers;

        const receiverLogger = new Logger(LogLevel.ERROR);
        const receiverRegistry = new PlacementRegistry(receiverLogger, { localNodeID: 'receiver' });
        const receiverOrchestrator = new MeshOrchestrator({
            nodeID: 'receiver',
            namespace: 'default',
            logger: receiverLogger,
            registry: receiverRegistry,
            send: async (): Promise<void> => undefined,
            publish: async (): Promise<void> => undefined,
        } as unknown as IMeshNetworkNode);

        await receiverOrchestrator.handlePEX({ peers });

        expect(receiverRegistry.getNode('sibling-spoke')?.metadata).toEqual({ role: 'dns', region: 'lon' });
        await receiverRegistry.stop();
    });
});
