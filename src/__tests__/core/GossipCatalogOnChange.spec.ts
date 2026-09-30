import {
    BEAT_TOPIC, MeshOrchestrator, PEERS_TOPIC, PRESENCE_REQUEST_TOPIC,
} from '../../core/MeshOrchestrator.js';
import { PlacementRegistry } from '../../core/PlacementRegistry.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import type { IMeshNetworkNode, NodeInfo } from '../../interfaces/IMeshNetwork.js';

/**
 * Gossip carries catalogs only when they change (v4.9.0). Until then every node broadcast its whole
 * catalog every 15 s and every known node's whole catalog every 10 s -- 4-9 MB/s per node on the
 * fleet with nothing happening, about half a CPU core per mesh node (live, 2026-09-30).
 *
 * Replaces PexMetadata.spec.ts: a node's labels no longer travel second-hand at all. Nothing is
 * registered from a peer list; a node's record, labels and catalog included, comes from its own
 * presence once linked.
 */

interface Sent { target: string; topic: string; payload: unknown }

const logger = new Logger(LogLevel.ERROR);

function peer(nodeID: string, over: Partial<NodeInfo> = {}): NodeInfo {
    return {
        nodeID,
        type: 'node',
        namespace: 'default',
        addresses: [`ws://203.0.113.${nodeID.length}:6005`],
        available: true,
        timestamp: Date.now(),
        nodeSeq: 5,
        bootedAt: 1000,
        hostname: nodeID,
        services: [{ name: 'dns', version: '1.0.0', tools: { 'dns.query': { name: 'dns.query', params: { big: 'x'.repeat(10_000) } } }, events: {} }],
        trustLevel: 'internal',
        metadata: { role: 'dns' },
        capabilities: {},
        pid: 1,
        ...over,
    } as NodeInfo;
}

function harness(nodeID = 'local'): {
    registry: PlacementRegistry; orchestrator: MeshOrchestrator; sent: Sent[]; published: Sent[]; dialed: string[];
} {
    const registry = new PlacementRegistry(logger, { localNodeID: nodeID });
    const sent: Sent[] = [];
    const published: Sent[] = [];
    const dialed: string[] = [];
    const node = {
        nodeID,
        namespace: 'default',
        logger,
        registry,
        send: async (target: string, topic: string, payload: unknown): Promise<void> => { sent.push({ target, topic, payload }); },
        publish: async (topic: string, payload: unknown): Promise<void> => { published.push({ target: '*', topic, payload }); },
        isPeerConnected: (id: string): boolean => registry.getNode(id) !== undefined,
        connectToPeer: async (id: string): Promise<void> => { dialed.push(id); },
    } as unknown as IMeshNetworkNode;
    return { registry, orchestrator: new MeshOrchestrator(node), sent, published, dialed };
}

describe('gossip carries catalogs only when they change', () => {
    let h: ReturnType<typeof harness>;

    beforeEach(() => {
        h = harness();
    });

    afterEach(async () => {
        await h.registry.stop();
    });

    it('a gossip round sends where nodes are, to the one peer picked, and no catalog', async () => {
        // Only one other node is available, so the random pick lands on it.
        const local = h.registry.getNode('local')!;
        local.available = false;
        h.registry.registerNode(local);
        h.registry.registerNode(peer('sibling'));

        await (h.orchestrator as unknown as { gossipRound(): Promise<void> }).gossipRound();

        expect(h.published).toEqual([]);
        expect(h.sent).toHaveLength(1);
        expect(h.sent[0]?.target).toBe('sibling');
        expect(h.sent[0]?.topic).toBe(PEERS_TOPIC);
        const body = JSON.stringify(h.sent[0]?.payload);
        expect(body).toContain('ws://203.0.113.7:6005');
        expect(body).not.toContain('services');
        expect(body.length).toBeLessThan(1000);
    });

    it('a peer list dials the nodes it names and registers none of them', async () => {
        await h.orchestrator.handlePeers({ peers: [{ nodeID: 'far', addresses: ['ws://198.51.100.3:6005'], namespace: 'default' }, { nodeID: 'local', addresses: ['ws://x'] }, 'junk'] });

        expect(h.dialed).toEqual(['far']);
        expect(h.registry.getNode('far')).toBeUndefined();
    });

    it('a beat is small and goes to every peer', async () => {
        await h.orchestrator.broadcastBeat();

        expect(h.sent).toHaveLength(1);
        expect(h.sent[0]?.target).toBe('*');
        expect(h.sent[0]?.topic).toBe(BEAT_TOPIC);
        expect(JSON.stringify(h.sent[0]?.payload).length).toBeLessThan(200);
    });

    it('a beat showing a newer catalog asks that peer for its presence, once per floor', async () => {
        h.registry.registerNode(peer('sibling'));

        await h.orchestrator.handleBeat('sibling', { nodeSeq: 5, bootedAt: 1000 });
        expect(h.sent).toEqual([]);

        await h.orchestrator.handleBeat('sibling', { nodeSeq: 6, bootedAt: 1000 });
        await h.orchestrator.handleBeat('sibling', { nodeSeq: 7, bootedAt: 1000 });
        expect(h.sent).toEqual([{ target: 'sibling', topic: PRESENCE_REQUEST_TOPIC, payload: {} }]);
    });

    it('a beat from a new boot, or from a node not on record, asks for its presence', async () => {
        h.registry.registerNode(peer('sibling'));
        await h.orchestrator.handleBeat('sibling', { nodeSeq: 2, bootedAt: 2000 });
        await h.orchestrator.handleBeat('stranger', { nodeSeq: 1 });
        await h.orchestrator.handleBeat('junk', { nodeSeq: 'nope' });

        expect(h.sent.map((s) => s.target)).toEqual(['sibling', 'stranger']);
    });

    it('answers a request for its presence with its whole record, to the one who asked', async () => {
        await h.orchestrator.handlePresenceRequest('sibling');

        expect(h.sent).toHaveLength(1);
        expect(h.sent[0]?.target).toBe('sibling');
        expect(h.sent[0]?.topic).toBe('$node.presence');
    });

    it('a record with no catalog keeps the one on record', () => {
        h.registry.registerNode(peer('sibling'));
        const { services: _drop, ...noCatalog } = peer('sibling', { nodeSeq: 9 });
        h.registry.registerNode(noCatalog as NodeInfo);

        expect(h.registry.getNode('sibling')?.services.map((s) => s.name)).toEqual(['dns']);
    });
});
