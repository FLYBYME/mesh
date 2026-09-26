import { IMeshNetworkNode, NodeInfo, IMeshOrchestrator, MeshPacket } from '../interfaces/IMeshNetwork.js';
import type { ILogger } from '../interfaces/ILogger.js';
import { SafeTimer } from '../utils/SafeTimer.js';
import { globalEventRegistry } from '../interfaces/IEventContract.js';
import { advertisableEvents } from './EventScope.js';
import type { TimerHandle } from '../interfaces/ITimer.js';

export interface MeshOrchestratorOptions {
    bootstrapNodes?: string[];
    gossipIntervalMs?: number;
}

// Long enough that a PEX round (every 10s, from every peer) cannot turn an
// unreachable node into a dial storm; short enough that a peer which restarts
// is re-attached within one lease window rather than one gossip era.
const DIAL_RETRY_FLOOR_MS = 20000;

/**
 * MeshOrchestrator — manages the DHT overlay network lifecycle and gossip.
 */
/**
 * How often a node tells its peers it is still there.
 *
 * A peer's liveness is judged entirely against this: the Registry marks a node offline after its
 * `ttl` elapses with no presence, so **a `ttl` below this interval can never work** -- every peer
 * would spend most of each cycle looking dead. `Registry` refuses such a `ttl` outright rather than
 * letting a cluster flap; see its constructor.
 */
export const PRESENCE_INTERVAL_MS = 15_000;

/**
 * How often the configured bootstrap peers are re-checked and redialed if not connected. Bootstrap
 * used to run once, at start: a bootstrap peer lost later came back only if the transport's own
 * reconnect loop happened to survive, or if some other peer's PEX mentioned it -- and a peer that
 * just disconnected has also just been removed from the registry, so PEX rarely did. Found live: the
 * cluster left as a star around one node, or with nodes holding no links at all, until restarted by
 * hand. Only a URL the transport says needs a dial is dialed (BaseTransport.needsDial), so this
 * cannot pile up dials.
 */
export const BOOTSTRAP_SUPERVISION_INTERVAL_MS = 15_000;

export class MeshOrchestrator implements IMeshOrchestrator {
    private logger: ILogger;
    private gossipInterval?: TimerHandle;
    private presenceInterval?: TimerHandle;
    private supervisionInterval?: TimerHandle;
    /** nodeID -> last dial attempt, so a PEX round cannot become a dial storm. */
    private dialAttempts = new Map<string, number>();
    /** One placeholder id per bootstrap URL, kept for the process's life so its logs line up. */
    private bootstrapIds = new Map<string, string>();

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
            this.supervisionInterval = setInterval(() => this.superviseBootstrapPeers(), BOOTSTRAP_SUPERVISION_INTERVAL_MS);
            SafeTimer.unref(this.supervisionInterval);
        }

        // Start Gossip interval
        this.gossipInterval = setInterval(() => this.gossipRound(), this.options.gossipIntervalMs || 10000);
        SafeTimer.unref(this.gossipInterval);

        // Start Presence broadcast interval (Heartbeat)
        this.presenceInterval = setInterval(() => this.broadcastPresence(), PRESENCE_INTERVAL_MS);
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
        if (this.supervisionInterval) {
            SafeTimer.clearInterval(this.supervisionInterval);
            this.supervisionInterval = undefined;
        }
    }

    private async bootstrap(): Promise<void> {
        for (const addr of this.options.bootstrapNodes || []) {
            try {
                this.logger.info(`Bootstrapping from ${addr}`);
                await this.node.connectToPeer(this.bootstrapId(addr), addr);
            } catch (err) {
                this.logger.warn(`Failed to bootstrap from ${addr}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }

    /**
     * Redial every bootstrap peer that is not connected. The transport decides what "connected"
     * means for a URL -- including a link the peer dialed to us, and a URL that is this node -- and
     * does nothing for those, or while a dial or a scheduled redial is already pending.
     */
    private superviseBootstrapPeers(): void {
        for (const addr of this.options.bootstrapNodes || []) {
            // A transport that cannot say (undefined) gets no redials: it has not promised that
            // dialing an already-connected peer again is harmless.
            if (this.node.needsDial?.(addr) !== true) continue;
            this.node.connectToPeer(this.bootstrapId(addr), addr).catch((err) => {
                this.logger.debug(
                    `Bootstrap peer ${addr} still unreachable: ${err instanceof Error ? err.message : String(err)}`,
                    { internal: true }
                );
            });
        }
    }

    /** A temporary ID; the peer's real one is learned during the handshake. */
    private bootstrapId(addr: string): string {
        let id = this.bootstrapIds.get(addr);
        if (id === undefined) {
            id = `bootstrap_${Math.random().toString(36).slice(2, 7)}`;
            this.bootstrapIds.set(addr, id);
        }
        return id;
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

        //this.logger.debug(`Gossip: Exchanging peer list with ${target.nodeID}`, { internal: true });

        // Send a random subset of our known nodes (max 50)
        const allKnown = this.node.registry.getNodes();
        const subset = allKnown.sort(() => 0.5 - Math.random()).slice(0, 50);

        // hostname and metadata travel with PEX too. Both are carried by $node.presence (which
        // sends the whole node record), but this projection used to drop them one at a time -- first
        // hostname (a node learned about second-hand showed up as "unknown" forever), now metadata
        // (an operator-declared --labels set learned about second-hand showed up as {} forever): the
        // registry's equal-nodeSeq fast path in registerNode only refreshes available/cpu/
        // activeRequests, so once a peer is first registered via PEX with no metadata, a later
        // $node.presence for that same nodeSeq can never backfill it.
        const peers = subset.map(n => ({
            nodeID: n.nodeID,
            addresses: n.addresses,
            namespace: n.namespace,
            type: n.type,
            services: n.services,
            available: n.available,
            timestamp: n.timestamp,
            bootedAt: n.bootedAt,
            nodeSeq: n.nodeSeq,
            nodeType: n.nodeType,
            parentID: n.parentID,
            hostname: n.hostname,
            metadata: n.metadata
        }));

        this.node.publish('$node.pex', { peers }).catch(() => { });
    }

    /**
     * Learns the event definitions a peer advertised, so this node can resolve who those events
     * belong to without loading the peer's code. The payload is off the wire: each entry is checked
     * rather than trusted, and a disagreement between peers keeps the stricter scope (see
     * EventContractRegistry.advertise) -- logged, since two builds disagreeing is worth knowing.
     */
    private recordAdvertisedEvents(node: NodeInfo): void {
        const events: unknown = node.events;
        if (!Array.isArray(events)) return;
        for (const entry of events) {
            if (typeof entry !== 'object' || entry === null || !('name' in entry) || typeof entry.name !== 'string') continue;
            const scopedBy = 'scopedBy' in entry && typeof entry.scopedBy === 'string' ? entry.scopedBy : undefined;
            if (!globalEventRegistry.advertise(entry.name, scopedBy)) {
                this.logger.warn(`Node ${node.nodeID} defines event "${entry.name}" scoped by ${scopedBy ?? 'nothing'}, which disagrees with another node's definition -- keeping the stricter one`);
            }
        }
    }

    public async broadcastPresence(targetNodeID?: string): Promise<void> {
        const localNode = this.node.registry.getNode(this.node.nodeID);
        if (!localNode) return;

        try {
            //this.logger.debug(`Broadcasting presence for ${this.node.nodeID}${targetNodeID ? ` to ${targetNodeID}` : ''}...`);
            // With this node's event definitions, read fresh each time: a part loaded since the last
            // broadcast has defined more of them (see NodeInfo.events).
            await this.node.send(targetNodeID || '*', '$node.presence', {
                node: { ...localNode, events: advertisableEvents() }
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
                bootedAt: n.bootedAt,
                nodeSeq: n.nodeSeq,
                nodeType: n.nodeType,
                parentID: n.parentID,
                hostname: n.hostname
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
            this.dialLearnedPeer(p);
        }
    }

    /**
     * Connects to a peer we have only heard about second-hand.
     *
     * Presence -- the only thing that refreshes a node's lease -- travels just
     * one hop, between directly connected peers. With everything bootstrapping
     * to a single hub, two spokes therefore never exchange presence: each knows
     * the other exists (via this PEX) but never hears it speak for itself, so
     * each expires the other's lease every 30s. getNextToolEndpoint skips
     * unavailable nodes, so a call from one spoke to a domain on another failed
     * roughly half the time with "no domain X is mounted anywhere on this
     * broker" -- for a node that was up the entire time.
     *
     * Packets can already be relayed through an intermediary, so reachability
     * was never the problem; liveness was. Dialing the peer directly fixes it at
     * the root: every pair exchanges presence, so every lease stays fresh, and
     * selectNode's routing becomes honest -- it only returns nodes this one can
     * actually reach.
     */
    private dialLearnedPeer(peer: NodeInfo): void {
        if (!this.node.isPeerConnected || this.node.isPeerConnected(peer.nodeID)) return;
        if ((peer.namespace || 'default') !== (this.node.namespace || 'default')) return;

        const addresses = peer.addresses || [];
        if (addresses.length === 0) return;

        // One attempt in flight per peer, and a floor between retries: a PEX
        // round arrives every 10s from every peer, so an unreachable node would
        // otherwise be dialed continuously by everyone that has heard of it.
        const now = Date.now();
        const lastAttempt = this.dialAttempts.get(peer.nodeID) ?? 0;
        if (now - lastAttempt < DIAL_RETRY_FLOOR_MS) return;
        this.dialAttempts.set(peer.nodeID, now);

        const address = addresses[0];
        this.logger.debug(`Dialing peer learned via PEX: ${peer.nodeID} at ${address}`, { internal: true });
        this.node.connectToPeer(peer.nodeID, address).catch((err) => {
            // Not an error: a peer can be legitimately unreachable from here
            // (NAT, a private overlay address, a node already shutting down).
            // The floor above keeps this from becoming a retry storm.
            this.logger.debug(
                `Could not dial ${peer.nodeID} at ${address}: ${err instanceof Error ? err.message : String(err)}`,
                { internal: true }
            );
        });
    }

    async handlePresence(data: { node: NodeInfo }): Promise<void> {
        if (!data.node || data.node.nodeID === this.node.nodeID) return;

        this.recordAdvertisedEvents(data.node);

        const isNew = !this.node.registry.getNode(data.node.nodeID);
        this.logger.debug(`Presence: Discovered node ${data.node.nodeID}`, {
            serviceCount: data.node.services.length,
            internal: true
        });
        // trusted: true -- this packet is the node speaking for itself, always more current than
        // whatever nodeSeq a stale PEX relay of it may still be holding. See registerNode's own
        // comment for the full story (mesh v4.2.4).
        this.node.registry.registerNode(data.node, true);

        // registerNode can refuse a node (a ghost of self, an address conflict). A refused peer is
        // still "new" on its next packet, and a reply to every "new" packet is a reply to every
        // packet -- and if the peer refuses us the same way, an unbounded ping-pong with no timer
        // and nothing logged. Not registered means there is nobody here to greet.
        if (this.node.registry.getNode(data.node.nodeID) === undefined) {
            this.logger.debug(`Presence: ${data.node.nodeID} was not registered; not replying`, { internal: true });
            return;
        }

        // A presence packet is the node speaking for ITSELF -- first-party proof
        // of life, arriving every 15s. registerNode deliberately refuses to
        // refresh the lease when nodeSeq is unchanged, so that second-hand PEX
        // gossip cannot keep a dead node alive forever. That rule is right, but
        // it also threw away the one signal that genuinely proves liveness,
        // because presence goes through the same path.
        //
        // The result was a registry that flapped on a 30/60s cycle against a
        // perfectly healthy peer: available -> offline at the 30s lease, pruned
        // at 60s, re-added by the next PEX, offline again 30s later. While a
        // node was in the offline half of that cycle, getNextToolEndpoint
        // skipped it, selectNode returned nothing, and the call fell back to a
        // local lookup that failed with "no domain X is mounted anywhere on
        // this broker" -- for a domain sitting on a node that was up the whole
        // time. Observed live 2026-08-30 across three local nodes.
        //
        // PEX still cannot refresh a lease. Presence can, because we know who
        // is making the claim.
        this.node.registry.heartbeat(data.node.nodeID);

        // If this is a new node discovering us, immediately send our presence back to them
        if (isNew) {
            await this.broadcastPresence(data.node.nodeID);
        }
    }
}
