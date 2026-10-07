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
/** How long a burst of local registry changes is gathered into one presence broadcast. */
export const PRESENCE_COALESCE_MS = 50;

/**
 * Gossip that carries catalogs only when they change (v4.9.0).
 *
 * Until then, every 15 s each node broadcast its *whole* description -- every contract's input and
 * output JSON Schema -- and every 10 s it broadcast every known node's whole description as PEX
 * (to all peers, though the round picked one). Measured live 2026-09-30: 4-9 MB/s per node on the
 * fleet tunnel with nothing happening, about half a CPU core per mesh node spent serializing,
 * encrypting and parsing it, and every api call slowed to seconds behind that work. On three local
 * bare nodes: a presence was ~230 KiB, a PEX ~680 KiB.
 *
 * Now:
 * - `$node.beat` every PRESENCE_INTERVAL_MS: nodeSeq, bootedAt, load -- a few hundred bytes. Every
 *   packet renews its sender's lease (MeshNetwork), so a beat keeps a node alive on old and new
 *   peers alike; an old peer has no handler for the topic and ignores it.
 * - The full `$node.presence` goes out when this node's catalog changes (schedulePresence), to a
 *   peer that just connected, to a peer that asks (`$node.presence.request`, sent when a beat shows
 *   a nodeSeq or boot this node has not seen), and every FULL_PRESENCE_REFRESH_MS as a backstop.
 * - `$node.peers` every gossip round, to the one peer picked: who exists and where, no catalogs.
 *   Only new nodes understand it; an old peer still learns peers from old nodes, and from the full
 *   `$node.pex` sent once when a link comes up.
 */
export const BEAT_TOPIC = '$node.beat';
export const PRESENCE_REQUEST_TOPIC = '$node.presence.request';
export const PEERS_TOPIC = '$node.peers';
export const FULL_PRESENCE_REFRESH_MS = 5 * 60_000;
/** A peer's presence is asked for at most this often, however many beats show it out of date. */
export const PRESENCE_REQUEST_FLOOR_MS = 10_000;

/** What a beat carries. */
export interface BeatData {
    nodeSeq: number;
    bootedAt?: number;
    cpu?: number;
    activeRequests?: number;
}

/** A beat off the wire, checked: undefined when it is not one. */
export function beatOf(payload: unknown): BeatData | undefined {
    if (typeof payload !== 'object' || payload === null) return undefined;
    const num = (key: string): number | undefined => {
        const v: unknown = Reflect.get(payload, key);
        return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    };
    const nodeSeq = num('nodeSeq');
    if (nodeSeq === undefined) return undefined;
    const bootedAt = num('bootedAt');
    const cpu = num('cpu');
    const activeRequests = num('activeRequests');
    return {
        nodeSeq,
        ...(bootedAt !== undefined ? { bootedAt } : {}),
        ...(cpu !== undefined ? { cpu } : {}),
        ...(activeRequests !== undefined ? { activeRequests } : {}),
    };
}

/** One `$node.peers` entry: where a node is, not what it runs. */
export interface PeerEntry {
    nodeID: string;
    addresses: string[];
    namespace?: string;
    nodeSeq?: number;
    bootedAt?: number;
    hostname?: string;
}

export class MeshOrchestrator implements IMeshOrchestrator {
    private logger: ILogger;
    private gossipInterval?: TimerHandle;
    private presenceInterval?: TimerHandle;
    private fullPresenceInterval?: TimerHandle;
    private supervisionInterval?: TimerHandle;
    /** Event-scope disagreements already logged (recordAdvertisedEvents): each is said once. */
    private readonly warnedDisagreements = new Set<string>();
    /** nodeID -> when its presence was last asked for (PRESENCE_REQUEST_FLOOR_MS). */
    private presenceRequests = new Map<string, number>();
    /** nodeID -> last dial attempt, so a PEX round cannot become a dial storm. */
    private dialAttempts = new Map<string, number>();
    /** One placeholder id per bootstrap URL, kept for the process's life so its logs line up. */
    private bootstrapIds = new Map<string, string>();

    constructor(
        private node: IMeshNetworkNode,
        private options: MeshOrchestratorOptions = {}
    ) {
        this.logger = node.logger.child({ name: 'MeshOrchestrator' });

        // Re-broadcast presence when the local registry changes (e.g. new services) -- once per burst.
        this.node.registry.on('local:changed', () => {
            this.schedulePresence();
        });
    }

    private presenceTimer: TimerHandle | undefined;

    /**
     * Coalesces presence broadcasts. Every contract registered or unregistered changes the local
     * registry, and a presence is the node's *whole* description -- every service, every contract's
     * info, every event -- serialized and sent to every peer, each of which then processes it. A part
     * of ~200 contracts loading or unloading did that ~200 times in a row: ~42 ms each, 8 s with the
     * event loop held, at both ends of every redeploy -- the node timed out even calling itself, and
     * its peers stalled processing the flood (surf and edge1, 2026-09-26). Now a burst of changes
     * sends one presence, PRESENCE_COALESCE_MS after the first.
     */
    private schedulePresence(): void {
        if (this.presenceTimer !== undefined) return;
        this.presenceTimer = setTimeout(() => {
            this.presenceTimer = undefined;
            void this.broadcastPresence();
        }, PRESENCE_COALESCE_MS);
        SafeTimer.unref(this.presenceTimer);
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

        // Beats keep leases; the full presence goes out on change, on connect, on request, and here.
        this.presenceInterval = setInterval(() => void this.broadcastBeat(), PRESENCE_INTERVAL_MS);
        SafeTimer.unref(this.presenceInterval);
        this.fullPresenceInterval = setInterval(() => void this.broadcastPresence(), FULL_PRESENCE_REFRESH_MS);
        SafeTimer.unref(this.fullPresenceInterval);

        // Immediate broadcast of our presence
        this.broadcastPresence();
    }

    async stop(): Promise<void> {
        SafeTimer.clearTimeout(this.presenceTimer);
        this.presenceTimer = undefined;
        if (this.gossipInterval) {
            SafeTimer.clearInterval(this.gossipInterval);
            this.gossipInterval = undefined;
        }
        if (this.presenceInterval) {
            SafeTimer.clearInterval(this.presenceInterval);
            this.presenceInterval = undefined;
        }
        if (this.fullPresenceInterval) {
            SafeTimer.clearInterval(this.fullPresenceInterval);
            this.fullPresenceInterval = undefined;
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

        // A random subset of our known nodes (max 50): where they are, not what they run. The
        // catalogs used to travel here too, to every peer, every 10 s (see BEAT_TOPIC's comment);
        // a node learns a peer's catalog from that peer's own presence once it dials it.
        const allKnown = this.node.registry.getNodes();
        const subset = allKnown.sort(() => 0.5 - Math.random()).slice(0, 50);
        const peers: PeerEntry[] = subset.map((n) => ({
            nodeID: n.nodeID,
            addresses: n.addresses,
            namespace: n.namespace,
            nodeSeq: n.nodeSeq,
            bootedAt: n.bootedAt,
            hostname: n.hostname,
        }));

        this.node.send(target.nodeID, PEERS_TOPIC, { peers }).catch(() => { });
    }

    /** Proof of life and the catalog's version, to every peer: a few hundred bytes. */
    public async broadcastBeat(): Promise<void> {
        const localNode = this.node.registry.getNode(this.node.nodeID);
        if (!localNode) return;
        const beat: BeatData = {
            nodeSeq: localNode.nodeSeq ?? 0,
            ...(localNode.bootedAt !== undefined ? { bootedAt: localNode.bootedAt } : {}),
            ...(localNode.cpu !== undefined ? { cpu: localNode.cpu } : {}),
            ...(localNode.activeRequests !== undefined ? { activeRequests: localNode.activeRequests } : {}),
        };
        try {
            await this.node.send('*', BEAT_TOPIC, beat);
        } catch (err) {
            this.logger.warn(`Failed to broadcast beat: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /**
     * A peer's beat. Its lease is already renewed (every packet does that); this takes its load and
     * asks for its presence when the beat shows a catalog or a boot this node has not seen.
     */
    async handleBeat(senderNodeID: string, payload: unknown): Promise<void> {
        const data = beatOf(payload);
        if (senderNodeID === this.node.nodeID || data === undefined) return;
        this.node.registry.heartbeat(senderNodeID, {
            ...(typeof data.cpu === 'number' ? { cpu: data.cpu } : {}),
            ...(typeof data.activeRequests === 'number' ? { activeRequests: data.activeRequests } : {}),
        });
        const known = this.node.registry.getNode(senderNodeID);
        const behind = known === undefined
            || (known.nodeSeq ?? 0) < data.nodeSeq
            || (typeof data.bootedAt === 'number' && known.bootedAt !== undefined && known.bootedAt !== data.bootedAt);
        if (!behind) return;
        const now = Date.now();
        if (now - (this.presenceRequests.get(senderNodeID) ?? 0) < PRESENCE_REQUEST_FLOOR_MS) return;
        this.presenceRequests.set(senderNodeID, now);
        this.logger.debug(`Beat from ${senderNodeID} shows nodeSeq ${data.nodeSeq}; asking for its presence`, { internal: true });
        await this.node.send(senderNodeID, PRESENCE_REQUEST_TOPIC, {}).catch(() => { });
    }

    /** A peer asked for this node's full presence. */
    async handlePresenceRequest(senderNodeID: string): Promise<void> {
        if (senderNodeID === this.node.nodeID) return;
        await this.broadcastPresence(senderNodeID);
    }

    /**
     * A `$node.peers` list: dials the ones this node is not linked to. Nothing is registered from
     * it -- a node's record, catalog included, comes from its own presence once linked.
     */
    async handlePeers(payload: unknown): Promise<void> {
        const peers: unknown = typeof payload === 'object' && payload !== null ? Reflect.get(payload, 'peers') : undefined;
        if (!Array.isArray(peers)) return;
        for (const entry of peers) {
            if (typeof entry !== 'object' || entry === null) continue;
            const nodeID: unknown = Reflect.get(entry, 'nodeID');
            const addresses: unknown = Reflect.get(entry, 'addresses');
            const namespace: unknown = Reflect.get(entry, 'namespace');
            if (typeof nodeID !== 'string' || nodeID === this.node.nodeID) continue;
            if (!Array.isArray(addresses) || !addresses.every((a) => typeof a === 'string')) continue;
            this.dialLearned(nodeID, addresses, typeof namespace === 'string' ? namespace : undefined);
        }
    }

    /**
     * Learns the event definitions a peer advertised, so this node can resolve who those events
     * belong to without loading the peer's code. The payload is off the wire: each entry is checked
     * rather than trusted. A presence is the node's whole list: it replaces what that node said
     * before. A disagreement between peers keeps the stricter scope (see
     * EventContractRegistry.advertise) -- logged, since two builds disagreeing is worth knowing.
     */
    private recordAdvertisedEvents(node: NodeInfo): void {
        const events: unknown = node.events;
        if (!Array.isArray(events)) return;
        const entries: Array<{ name: string; scopedBy?: string }> = [];
        for (const entry of events) {
            if (typeof entry !== 'object' || entry === null || !('name' in entry) || typeof entry.name !== 'string') continue;
            const scopedBy = 'scopedBy' in entry && typeof entry.scopedBy === 'string' ? entry.scopedBy : undefined;
            entries.push(scopedBy === undefined ? { name: entry.name } : { name: entry.name, scopedBy });
        }
        for (const name of globalEventRegistry.advertiseAll(node.nodeID, entries)) {
            const mine = entries.find((e) => e.name === name)?.scopedBy;
            // Once per node, event and scope: every full presence repeats the list, and a peer
            // reconnecting in a loop sent this ~50 times per 400 lines on every node (2026-10-06).
            const key = `${node.nodeID}|${name}|${mine ?? ''}`;
            if (this.warnedDisagreements.has(key)) continue;
            this.warnedDisagreements.add(key);
            this.logger.warn(`Node ${node.nodeID} defines event "${name}" scoped by ${mine ?? 'nothing'}, which disagrees with another node's definition -- keeping the stricter one`);
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

            // 2. Send our known peers to the new peer (targeted PEX): where they are, not what they
            // run -- the same as the periodic exchange. Every node's whole catalog used to travel
            // here, on every reconnect, and each one was re-registered on arrival: a link dropping
            // and rejoining in a loop moved the mesh's catalog each time (edge1, 2026-10-06). A node
            // learns a peer's catalog from that peer's own presence once it dials it.
            const allKnown = this.node.registry.getNodes();
            const peers = allKnown.map(n => ({
                nodeID: n.nodeID,
                addresses: n.addresses,
                namespace: n.namespace,
                type: n.type,
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
        this.dialLearned(peer.nodeID, peer.addresses || [], peer.namespace);
    }

    private dialLearned(nodeID: string, addresses: readonly string[], namespace: string | undefined): void {
        if (!this.node.isPeerConnected || this.node.isPeerConnected(nodeID)) return;
        if ((namespace || 'default') !== (this.node.namespace || 'default')) return;
        const address = addresses[0];
        if (address === undefined) return;

        // One attempt in flight per peer, and a floor between retries: a PEX
        // round arrives every 10s from every peer, so an unreachable node would
        // otherwise be dialed continuously by everyone that has heard of it.
        const now = Date.now();
        const lastAttempt = this.dialAttempts.get(nodeID) ?? 0;
        if (now - lastAttempt < DIAL_RETRY_FLOOR_MS) return;
        this.dialAttempts.set(nodeID, now);

        this.logger.debug(`Dialing peer learned via PEX: ${nodeID} at ${address}`, { internal: true });
        this.node.connectToPeer(nodeID, address).catch((err) => {
            // Not an error: a peer can be legitimately unreachable from here
            // (NAT, a private overlay address, a node already shutting down).
            // The floor above keeps this from becoming a retry storm.
            this.logger.debug(
                `Could not dial ${nodeID} at ${address}: ${err instanceof Error ? err.message : String(err)}`,
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
