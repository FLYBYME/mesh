import { IMeshNetworkNode, NodeInfo, IMeshOrchestrator, MeshPacket } from '../interfaces/IMeshNetwork.js';
import type { ILogger } from '../interfaces/ILogger.js';
import { SafeTimer } from '../utils/SafeTimer.js';
import type { TimerHandle } from '../interfaces/ITimer.js';

export interface MeshOrchestratorOptions {
    bootstrapNodes?: string[];
    gossipIntervalMs?: number;
}

/**
 * MeshOrchestrator — manages the DHT overlay network lifecycle and gossip.
 */
export class MeshOrchestrator implements IMeshOrchestrator {
    private logger: ILogger;
    private gossipInterval?: TimerHandle;
    private presenceInterval?: TimerHandle;

    constructor(
        private node: IMeshNetworkNode,
        private options: MeshOrchestratorOptions = {}
    ) {
        this.logger = node.logger.child({ name: 'MeshOrchestrator' });

        // Re-broadcast presence when local registry changes (e.g. new services)
        this.node.registry.on('local:changed', () => {
            this.broadcastPresence();
        });
    }

    async start(): Promise<void> {
        this.logger.info(`MeshOrchestrator starting with ${this.options.bootstrapNodes?.length || 0} bootstrap nodes`);

        if (this.options.bootstrapNodes?.length) {
            await this.bootstrap();
        }

        // Start Gossip interval
        this.gossipInterval = setInterval(() => this.gossipRound(), this.options.gossipIntervalMs || 10000);
        SafeTimer.unref(this.gossipInterval);

        // Start Presence broadcast interval (Heartbeat)
        this.presenceInterval = setInterval(() => this.broadcastPresence(), 15000);
        SafeTimer.unref(this.presenceInterval);

        // Immediate broadcast of our presence
        this.broadcastPresence();
    }

    async stop(): Promise<void> {
        if (this.gossipInterval) {
            SafeTimer.clearInterval(this.gossipInterval);
            this.gossipInterval = undefined;
        }
        if (this.presenceInterval) {
            SafeTimer.clearInterval(this.presenceInterval);
            this.presenceInterval = undefined;
        }
    }

    private async bootstrap(): Promise<void> {
        for (const addr of this.options.bootstrapNodes || []) {
            try {
                this.logger.info(`Bootstrapping from ${addr}`);
                // Attempt to connect to the bootstrap peer. 
                // We use a temporary ID; the actual ID will be resolved during handshake.
                await this.node.connectToPeer(`bootstrap_${Math.random().toString(36).substr(2, 5)}`, addr);
            } catch (err) {
                this.logger.warn(`Failed to bootstrap from ${addr}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }

    /**
     * Gossip Protocol: Periodically exchange known peer lists (PEX).
     */
    private async gossipRound(): Promise<void> {
        const nodes = (this.node.registry.getAvailableNodes() as NodeInfo[]);
        if (nodes.length === 0) return;

        // Select a random peer to gossip with
        const target = nodes[Math.floor(Math.random() * nodes.length)];
        // Don't gossip with ourselves
        if (target.nodeID === this.node.nodeID) return;

        this.logger.debug(`Gossip: Exchanging peer list with ${target.nodeID}`, { internal: true });

        // Send a random subset of our known nodes (max 50)
        const allKnown = this.node.registry.getNodes();
        const subset = allKnown.sort(() => 0.5 - Math.random()).slice(0, 50);

        const peers = subset.map(n => ({
            nodeID: n.nodeID,
            addresses: n.addresses,
            namespace: n.namespace,
            type: n.type,
            services: n.services,
            available: n.available,
            timestamp: n.timestamp,
            nodeSeq: n.nodeSeq,
            nodeType: n.nodeType,
            parentID: n.parentID
        }));

        this.node.publish('$node.pex', { peers }).catch(() => { });
    }

    public async broadcastPresence(targetNodeID?: string): Promise<void> {
        const localNode = this.node.registry.getNode(this.node.nodeID);
        if (!localNode) return;

        try {
            this.logger.debug(`Broadcasting presence for ${this.node.nodeID}${targetNodeID ? ` to ${targetNodeID}` : ''}...`);
            await this.node.send(targetNodeID || '*', '$node.presence', {
                node: localNode
            });
        } catch (err) {
            this.logger.warn(`Failed to broadcast presence to ${targetNodeID || '*'}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /**
     * Immediate Peer Reconstruction:
     * When a peer connects, send them our presence AND our full peer list (PEX).
     */
    async handlePeerConnect(nodeID: string): Promise<void> {
        try {
            this.logger.info(`[MeshOrchestrator] Peer connected: ${nodeID}. Sending immediate presence and PEX.`);

            // 1. Send our presence to the new peer
            await this.broadcastPresence(nodeID);

            // 2. Send our known peers to the new peer (targeted PEX)
            const allKnown = this.node.registry.getNodes();
            const peers = allKnown.map(n => ({
                nodeID: n.nodeID,
                addresses: n.addresses,
                namespace: n.namespace,
                type: n.type,
                services: n.services,
                available: n.available,
                timestamp: n.timestamp,
                nodeSeq: n.nodeSeq,
                nodeType: n.nodeType,
                parentID: n.parentID
            }));

            await this.node.send(nodeID, '$node.pex', { peers });
        } catch (err) {
            this.logger.warn(`Error during peer reconstruction for ${nodeID}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /**
     * Immediate Peer Removal:
     * When a transport detects a disconnect, remove the node immediately.
     */
    async handlePeerDisconnect(nodeID: string): Promise<void> {
        this.logger.info(`[MeshOrchestrator] Peer disconnected: ${nodeID}. Removing from registry.`);
        this.node.registry.unregisterNode(nodeID);
    }

    /**
     * Handles incoming Peer Exchange (PEX) data.
     */
    async handlePEX(data: { peers: Partial<NodeInfo>[] }): Promise<void> {
        if (!data.peers || !Array.isArray(data.peers)) return;

        for (const peer of data.peers) {
            const p = peer as NodeInfo;
            if (!p.nodeID || p.nodeID === this.node.nodeID) continue;
            this.node.registry.registerNode(p);
        }
    }

    async handlePresence(data: { node: NodeInfo }): Promise<void> {
        if (!data.node || data.node.nodeID === this.node.nodeID) return;

        const isNew = !this.node.registry.getNode(data.node.nodeID);
        this.logger.debug(`Presence: Discovered node ${data.node.nodeID}`, {
            serviceCount: data.node.services.length,
            internal: true
        });
        this.node.registry.registerNode(data.node);

        // If this is a new node discovering us, immediately send our presence back to them
        if (isNew) {
            await this.broadcastPresence(data.node.nodeID);
        }
    }
}
