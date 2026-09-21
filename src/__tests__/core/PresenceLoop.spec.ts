import { MeshOrchestrator } from '../../core/MeshOrchestrator.js';
import { PlacementRegistry } from '../../core/PlacementRegistry.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import type { IMeshNetworkNode, NodeInfo } from '../../interfaces/IMeshNetwork.js';

/**
 * A presence packet from a node we don't know gets an immediate presence back, so the newcomer
 * learns about us. "Don't know" was decided *before* registerNode ran -- and registerNode can refuse
 * a node (ghost of self: an address that overlaps ours). A refused peer therefore stayed "new" on
 * every packet, every packet drew a reply, and the peer -- refusing us for the same reason -- did
 * the same: presence packets ping-ponging at wire speed with no timer and no log line. Found live
 * as three machines each pinned at 100% of a core the moment they joined.
 */
describe('presence replies cannot loop when a peer is refused', () => {
    const peer = (nodeID: string, address: string): NodeInfo => ({
        nodeID,
        type: 'node',
        namespace: 'default',
        addresses: [address],
        available: true,
        timestamp: Date.now(),
        nodeSeq: 1,
        hostname: 'remote',
        services: [],
        trustLevel: 'internal',
        metadata: {},
        capabilities: { transports: ['ws'], features: [] },
        pid: 1,
    } as NodeInfo);

    let registry: PlacementRegistry;
    let sent: Array<{ target: string; topic: string }>;
    let orchestrator: MeshOrchestrator;

    beforeEach(() => {
        const logger = new Logger(LogLevel.ERROR);
        registry = new PlacementRegistry(logger, { localNodeID: 'local' });
        sent = [];

        const local = registry.getNode('local')!;
        local.addresses = ['ws://0.0.0.0:6005'];
        registry.registerNode(local);

        const node = {
            nodeID: 'local',
            namespace: 'default',
            logger,
            registry,
            send: async (target: string, topic: string): Promise<void> => { sent.push({ target, topic }); },
            publish: async (): Promise<void> => undefined,
        } as unknown as IMeshNetworkNode;
        orchestrator = new MeshOrchestrator(node);
    });

    afterEach(async () => {
        await registry.stop();
    });

    const presenceReplies = (): number => sent.filter((s) => s.topic === '$node.presence').length;

    it('sends nothing back to a peer the registry refused, however many packets arrive', async () => {
        for (let i = 0; i < 5; i++) {
            await orchestrator.handlePresence({ node: peer('ghost', 'ws://0.0.0.0:6005') });
        }

        expect(registry.getNode('ghost')).toBeUndefined();
        expect(presenceReplies()).toBe(0);
    });

    it('still greets a genuinely new peer exactly once', async () => {
        await orchestrator.handlePresence({ node: peer('real', 'ws://203.0.113.8:6005') });
        await orchestrator.handlePresence({ node: peer('real', 'ws://203.0.113.8:6005') });
        await orchestrator.handlePresence({ node: peer('real', 'ws://203.0.113.8:6005') });

        expect(registry.getNode('real')).toBeDefined();
        expect(presenceReplies()).toBe(1);
        expect(sent[0]?.target).toBe('real');
    });
});
