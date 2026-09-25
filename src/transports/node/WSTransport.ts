import { BaseTransport } from '../BaseTransport.js';
import { BaseSerializer } from '../../serializers/BaseSerializer.js';
import { errorFromWire } from '../../core/MeshError.js';
import type { TransportConnectOptions, IWS, IWSServer, MeshPacket, PeerLink } from '../../interfaces/IMeshNetwork.js';
import http from 'node:http';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { ILogger } from '../../interfaces/ILogger.js';

interface PendingRPC {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
    timeout: NodeJS.Timeout;
}

export interface WSTransportOptions {
    pingIntervalMs?: number;
    pingTimeoutMs?: number;
    authKey?: string;
    authToken?: string;
}

/**
 * Close code for "your nodeID is already connected here". In the application range (4000-4999), and
 * 4409 for HTTP 409 Conflict, which is what this is. Reconnecting will not help while the incumbent
 * lives, so the client stops rather than looping.
 */
export const DUPLICATE_NODE_ID_CLOSE = 4409;

/**
 * Close code for a second connection between the same two live processes -- both dialed each other
 * at once, which every node does now that each dials every peer. Exactly one of the two is kept,
 * chosen identically on both ends; the other is closed with this. Not an error and not a reason to
 * reconnect: the kept connection carries the link.
 */
export const REDUNDANT_CONNECTION_CLOSE = 4000;

/**
 * Carries a transport's per-process instance id: sent on dial, echoed on the upgrade response. It is
 * what tells "the same peer process, a second socket" (keep one) apart from "a different process
 * claiming the same nodeID" (a restart, or a genuine duplicate) -- a nodeID alone cannot.
 */
const INSTANCE_HEADER = 'x-mesh-instance';

/**
 * Carries a transport's nodeID in the same handshake, so both ends know who is on a socket the moment
 * it opens instead of at its first message. Without it an outbound bootstrap dial sat under a
 * `bootstrap_<rand>` placeholder until the peer spoke, and a collision with another socket to the
 * same peer could not be seen until then. Older peers send neither header; identification by first
 * message still works for them.
 */
const NODE_HEADER = 'x-mesh-node';

/** Ceiling for per-peer reconnect backoff, and the delay after a duplicate-nodeID refusal. */
const RECONNECT_BACKOFF_CAP_MS = 30_000;

/** Consecutive failed reconnects to one URL before it is worth a warning (logged once). */
const RECONNECT_WARN_AFTER = 5;

/** What this transport knows about one socket beyond what `ws` does. */
interface SocketInfo {
    /** Who opened it: this process ('self', an outbound dial) or the peer ('remote', inbound). */
    dialedBy: 'self' | 'remote';
    /** The peer process's instance id, when it sent one (older peers do not). */
    remoteInstance?: string;
    /** The nodeID this socket has identified as -- whether or not it currently owns `peers[id]`. */
    peerId?: string;
    /** A liveness probe of the socket already holding this peer's id is in flight. */
    resolving?: boolean;
    /** Closed on purpose in favour of another socket to the same peer: not a loss, not a reconnect. */
    superseded?: boolean;
    /** A ping is out and its pong has not come back. */
    awaitingPong: boolean;
    /** When a real frame last arrived -- stronger proof of life than a pong; see hasRecentTraffic. */
    lastMessageAt: number;
    /** When the socket was accepted or dialed. */
    readonly openedAt: number;
    pingTimeoutTimer?: NodeJS.Timeout;
}

/** A header's value from an http request/response-shaped object, without trusting its type. */
function headerValue(source: unknown, name: string): string | undefined {
    if (typeof source !== 'object' || source === null || !('headers' in source)) return undefined;
    const headers: unknown = source.headers;
    if (typeof headers !== 'object' || headers === null) return undefined;
    const value: unknown = Reflect.get(headers, name);
    return typeof value === 'string' ? value : undefined;
}

/**
 * WSTransport — Node.js implementation using 'ws' and 'http'.
 */
export class WSTransport extends BaseTransport {
    readonly protocol = 'ws';
    public readonly version = 1;

    private wss: IWSServer | null = null;
    private server: http.Server | null = null;
    private port: number;
    private host: string;
    private peers = new Map<string, IWS>();
    public logger?: ILogger;
    public authKey?: string;

    private pendingRPCs = new Map<string, PendingRPC>();
    private static readonly RPC_TIMEOUT_MS = 10000;
    /**
     * Consecutive failed reconnects, per peer URL. Per peer, not one counter for the whole
     * transport: a single shared count with a hard cap of ten meant that after ten reconnects across
     * *all* peers it logged "Max reconnection attempts reached" and never reconnected anyone again --
     * one of the reasons links on the live cluster stayed down after restarts.
     */
    private readonly reconnectFailures = new Map<string, number>();
    /** URLs whose duplicate-nodeID refusal has been logged, so a slow retry loop logs it once. */
    private readonly refusalLogged = new Set<string>();
    private heartbeatTimer?: NodeJS.Timeout;
    /** A scheduled redial, per peer URL -- at most one each. */
    private readonly reconnectionTimers = new Map<string, NodeJS.Timeout>();
    /** This process's own instance id -- see INSTANCE_HEADER. */
    public readonly instanceId = randomUUID();
    private readonly socketInfo = new WeakMap<IWS, SocketInfo>();
    /** Every socket not yet closed, owned or not -- a standby is promoted from here; see releasePeer. */
    private readonly liveSockets = new Set<IWS>();
    /** The outbound socket currently open or opening to each URL -- at most one each. */
    private readonly outbound = new Map<string, IWS>();
    /** The nodeID each dialed URL turned out to be, so a redial can tell it is already connected. */
    private readonly urlNode = new Map<string, string>();

    public pingIntervalMs: number;
    public pingTimeoutMs: number;

    constructor(serializer: BaseSerializer, port = 0, host: string = '127.0.0.1', options: WSTransportOptions = {}) {
        super(serializer);
        this.port = port;
        this.host = host;
        this.pingIntervalMs = options.pingIntervalMs ?? 30000;
        this.pingTimeoutMs = options.pingTimeoutMs ?? Math.min(5000, this.pingIntervalMs);
        this.authKey = options.authKey ?? options.authToken ?? process.env.MESH_KEY;
    }

    async start(): Promise<void> {
        this.proactiveReplay();
        this.startHeartbeat();
    }

    public getPort(): number {
        if (!this.server || typeof this.server.address !== 'function') throw new Error("Server not started yet.");
        const addr = this.server.address();
        if (addr && typeof addr === 'object' && 'port' in addr) {
            return (addr as { port: number }).port;
        }
        throw new Error("Server port not available");
    }

    public getHost(): string {
        return this.host;
    }

    private proactiveReplay(): void {
        this.logger?.info('[WSTransport] Initializing proactive offline queue replay...');
        // Proactive Replay Implementation:
        // 1. Query all targets with pending RPCs from local storage
        // 2. For each target, check if nodeID is in registry
        // 3. If found, call this.connectToPeer(nodeID, node.address)
    }

    async connect(opts: TransportConnectOptions & WSTransportOptions): Promise<void> {
        this.nodeID = opts.nodeID || this.nodeID;
        this.logger = opts.logger;
        if (opts.pingIntervalMs !== undefined) this.pingIntervalMs = opts.pingIntervalMs;
        if (opts.pingTimeoutMs !== undefined) this.pingTimeoutMs = opts.pingTimeoutMs;
        if (opts.host !== undefined) this.host = opts.host;
        if (opts.port !== undefined && opts.port > 0) this.port = opts.port;
        if (opts.authKey !== undefined) this.authKey = opts.authKey;
        else if (opts.authToken !== undefined) this.authKey = opts.authToken;
        else if (!this.authKey && process.env.MESH_KEY) this.authKey = process.env.MESH_KEY;

        if (!this.authKey && !this.isLoopbackAddress(this.host)) {
            throw new Error(
                `[WSTransport] Refusing to start on non-loopback host "${this.host}" without authentication key. ` +
                `Set MESH_KEY environment variable or pass authKey in options to secure the mesh port.`
            );
        }

        if (opts.sharedServer) {
            this.logger?.debug(`[WSTransport] Attaching to shared server...`);
            return this.attachToSharedServer(opts.sharedServer as http.Server);
        }

        this.logger?.info(`[WSTransport] Starting standalone server on port ${this.port}...`);
        return this.startNodeServer();
    }

    public isLoopbackAddress(addr?: string): boolean {
        if (!addr) return false;
        return addr === '127.0.0.1' || addr.startsWith('127.') || addr === '::1' || addr.startsWith('::ffff:127.') || addr === 'localhost';
    }

    private timingSafeEqual(a: string, b: string): boolean {
        const bufA = Buffer.from(a);
        const bufB = Buffer.from(b);
        if (bufA.length !== bufB.length) return false;
        return crypto.timingSafeEqual(bufA, bufB);
    }

    public verifyHandshake(
        info: { origin?: string; secure?: boolean; req: http.IncomingMessage },
        cb: (res: boolean, code?: number, message?: string, headers?: http.OutgoingHttpHeaders) => void
    ): void {
        const req = info.req;
        const remoteIp = req.socket?.remoteAddress;
        const isLoopback = this.isLoopbackAddress(remoteIp);

        // Extract key from headers or URL query
        let clientKey: string | undefined;

        // 1. x-mesh-key header
        const meshKeyHeader = req.headers ? req.headers['x-mesh-key'] : undefined;
        if (typeof meshKeyHeader === 'string') {
            clientKey = meshKeyHeader;
        }

        // 2. Authorization header (Bearer token)
        if (!clientKey && req.headers) {
            const authHeader = req.headers['authorization'];
            if (typeof authHeader === 'string') {
                if (authHeader.startsWith('Bearer ')) {
                    clientKey = authHeader.slice(7).trim();
                } else {
                    clientKey = authHeader.trim();
                }
            }
        }

        // 3. URL query parameter (?key=... or ?token=...)
        if (!clientKey && req.url) {
            try {
                const parsedUrl = new URL(req.url, 'http://localhost');
                const qKey = parsedUrl.searchParams.get('key') || parsedUrl.searchParams.get('token');
                if (qKey) clientKey = qKey;
            } catch {
                // Ignore malformed URL
            }
        }

        const expectedKey = this.authKey;

        // If a key is configured on this transport, authentication is mandatory for all connections.
        if (expectedKey) {
            if (!clientKey) {
                this.logger?.warn(`[WSTransport] Handshake rejected: missing authentication key from ${remoteIp || 'unknown'}`);
                return cb(false, 401, 'Unauthorized: missing authentication key');
            }

            if (!this.timingSafeEqual(clientKey, expectedKey)) {
                this.logger?.warn(`[WSTransport] Handshake rejected: invalid authentication key from ${remoteIp || 'unknown'}`);
                return cb(false, 403, 'Forbidden: invalid authentication key');
            }

            return cb(true);
        }

        // If NO key is configured:
        // Unauthenticated loopback is allowed for local development.
        if (isLoopback) {
            return cb(true);
        }

        // Non-loopback connection without key configured on server is rejected.
        this.logger?.warn(`[WSTransport] Handshake rejected: non-loopback connection from ${remoteIp || 'unknown'} requires authentication key`);
        return cb(false, 401, 'Unauthorized: authentication key required for non-loopback connections');
    }

    private async attachToSharedServer(server: http.Server): Promise<void> {
        this.server = server;
        this.wss = new WebSocketServer({
            server: this.server,
            verifyClient: (info: any, cb: any) => this.verifyHandshake(info, cb)
        }) as IWSServer;
        this.setupWSSHandlers();
        this.connected = true;
        this.emit('connected');
        this.startHeartbeat();
    }

    private async startNodeServer(): Promise<void> {
        this.server = http.createServer();
        this.wss = new WebSocketServer({
            server: this.server,
            verifyClient: (info: any, cb: any) => this.verifyHandshake(info, cb)
        }) as IWSServer;
        this.setupWSSHandlers();

        return new Promise((resolve, reject) => {
            if (!this.server) return reject(new Error('Server not initialized'));
            this.server.listen(this.port, this.host, () => {
                const addr = this.server!.address();
                if (addr && typeof addr === 'object' && 'port' in addr) {
                    this.port = (addr as { port: number }).port;
                }
                this.connected = true;
                this.emit('connected');
                this.startHeartbeat();
                resolve();
            });
            this.server.on('error', reject);
        });
    }

    private setupWSSHandlers() {
        if (!this.wss) return;

        // Answer every upgrade with who we are, so the dialer knows at 'open' -- see NODE_HEADER.
        this.wss.on('headers', (headers: string[]) => {
            headers.push(`${NODE_HEADER}: ${this.nodeID}`, `${INSTANCE_HEADER}: ${this.instanceId}`);
        });

        this.wss.on('connection', (ws: IWS, req: unknown) => {
            const info = this.trackSocket(ws, 'remote');
            info.remoteInstance = headerValue(req, INSTANCE_HEADER) || undefined;
            const remoteNode = headerValue(req, NODE_HEADER) || undefined;

            ws.on('message', (raw: unknown) => {
                this.handleIncomingMessage(raw, ws, (id) => this.claimPeer(id, ws));
            });

            ws.on('close', () => {
                this.forgetSocket(ws);
                // releasePeer is ownership-checked: a socket that was refused, superseded, or left
                // standing by never owned `peers[id]` and so can never evict the socket that does.
                if (info.peerId !== undefined) this.releasePeer(info.peerId, ws);
            });

            if (remoteNode === this.nodeID) {
                this.refuseOwnNodeId(ws, info);
                return;
            }
            if (remoteNode !== undefined) this.claimPeer(remoteNode, ws);
        });
    }

    /** An inbound socket whose dialer claims *our* nodeID: ourselves (a bootstrap list that includes
     *  this node's own address), or a second process configured with our id. */
    private refuseOwnNodeId(ws: IWS, info: SocketInfo): void {
        if (info.remoteInstance === this.instanceId) {
            info.superseded = true;
            ws.close(REDUNDANT_CONNECTION_CLOSE, 'connected to itself');
            return;
        }
        this.logger?.error(`[WSTransport] Refusing connection: another process is using this node's own nodeID "${this.nodeID}". Two processes cannot share one nodeID -- give that one its own.`);
        ws.close(DUPLICATE_NODE_ID_CLOSE, `nodeID "${this.nodeID}" already connected`);
    }

    /**
     * `ws` has identified as `id`. The one place a socket becomes the connection for a peer -- used
     * by inbound and outbound sockets alike, at the handshake and again on every message.
     *
     * When another open socket already holds `id`, this decides which one keeps it:
     *
     * - **Same remote process** (same instance id): a second socket between the same two processes,
     *   normally because both dialed each other at once. See resolveRedundant.
     * - **A different process, or one that cannot say** (no instance id): either the peer restarted
     *   and the incumbent is a stale socket to its old process, or two live processes really do share
     *   one nodeID. See probeIncumbent.
     *
     * Before this, the server side refused *every* such second socket as a duplicate identity (4409),
     * which is permanent to the dialer -- so a simultaneous dial could leave the pair with no link at
     * all, and a restarted peer was refused by its own stale socket and never retried. The client
     * side did the opposite, overwriting the live entry unchecked.
     */
    private claimPeer(id: string, ws: IWS): void {
        const mine = this.infoOf(ws);
        if (mine.superseded || mine.resolving || ws.readyState !== WebSocket.OPEN) return;
        mine.peerId = id;

        const existing = this.peers.get(id);
        if (existing === ws) return;

        if (existing === undefined || existing.readyState !== WebSocket.OPEN) {
            // Nothing live holds it. A closing socket's own close handler finds it no longer owns
            // the entry, so it emits nothing.
            this.peers.set(id, ws);
            this.emit('peer:connect', id);
            return;
        }

        const theirs = this.infoOf(existing);
        if (mine.remoteInstance !== undefined && mine.remoteInstance === theirs.remoteInstance) {
            this.resolveRedundant(id, ws, existing);
            return;
        }
        this.probeIncumbent(id, ws, existing);
    }

    /**
     * Two open sockets to the same peer process. Exactly one is kept, and both ends must choose the
     * same one without talking about it:
     *
     * - Dialed by different ends (simultaneous dial): keep the one dialed by the lexicographically
     *   smaller nodeID -- the same socket as seen from either side.
     * - Dialed by the same end (two dials raced, e.g. a bootstrap dial and a PEX dial): only the
     *   dialing end closes one. The other end leaves the second as a standby, so whichever of the two
     *   the dialer keeps, releasePeer promotes it here when the other closes.
     *
     * The loser is closed with REDUNDANT_CONNECTION_CLOSE and marked superseded: it emits no
     * `peer:disconnect` and starts no reconnect, because the peer is still connected.
     */
    private resolveRedundant(id: string, newcomer: IWS, incumbent: IWS): void {
        const mine = this.infoOf(newcomer);
        const theirs = this.infoOf(incumbent);

        if (mine.dialedBy !== theirs.dialedBy) {
            const keptDialer: SocketInfo['dialedBy'] = this.nodeID < id ? 'self' : 'remote';
            const keep = mine.dialedBy === keptDialer ? newcomer : incumbent;
            const drop = keep === newcomer ? incumbent : newcomer;
            if (keep === newcomer) this.peers.set(id, newcomer);
            this.supersede(drop);
            return;
        }

        if (mine.dialedBy === 'self') this.supersede(newcomer);
    }

    /**
     * A socket from a different process (or one that sends no instance id) claims a nodeID a live
     * socket already holds. Ask the incumbent: one ping, `pingTimeoutMs` to answer.
     *
     * - No answer: it is a stale socket to a process that is gone -- the usual case, a peer that
     *   restarted before this side noticed the old connection die. Terminate it and let the newcomer
     *   have the id.
     * - An answer: two live processes really do share one nodeID. `peers` is keyed by nodeID and
     *   `send()` resolves exactly one socket per key, so only one can ever be reachable. Refuse the
     *   newcomer with DUPLICATE_NODE_ID_CLOSE and say why -- a silently accepted newcomer was
     *   connected but deaf (found live: a `mesh-serve bootstrap` with a hardcoded nodeID, interrupted
     *   mid-wizard, made every later bootstrap against that node fail while the first lived).
     */
    private probeIncumbent(id: string, newcomer: IWS, incumbent: IWS): void {
        const mine = this.infoOf(newcomer);
        mine.resolving = true;

        let settled = false;
        const settle = (incumbentAnswered: boolean): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            mine.resolving = false;
            if (newcomer.readyState !== WebSocket.OPEN) return;

            const stillHeld = this.peers.get(id) === incumbent && incumbent.readyState === WebSocket.OPEN;
            if (incumbentAnswered && stillHeld) {
                this.logger?.error(`[WSTransport] Refusing connection: nodeID "${id}" is already connected from another live process. Two processes cannot share one nodeID -- give this one its own.`);
                newcomer.close(DUPLICATE_NODE_ID_CLOSE, `nodeID "${id}" already connected`);
                return;
            }
            if (stillHeld) {
                this.terminatePeerForPingFailure(id, incumbent, `did not answer a probe while a new process claims its nodeID; replacing the stale socket`);
            }
            this.claimPeer(id, newcomer);
        };

        const timer = setTimeout(() => settle(false), this.pingTimeoutMs);
        timer.unref();
        incumbent.once('pong', () => settle(true));
        incumbent.once('close', () => settle(false));

        if (!incumbent.ping) {
            // Cannot ask, so do what was done before probing existed: the incumbent keeps it.
            settle(true);
            return;
        }
        try {
            incumbent.ping();
        } catch {
            settle(false);
        }
    }

    /** Close `ws` in favour of another socket to the same peer -- see resolveRedundant. */
    private supersede(ws: IWS): void {
        this.infoOf(ws).superseded = true;
        ws.close(REDUNDANT_CONNECTION_CLOSE, 'redundant connection');
    }

    /**
     * `ws` is going away. If it held `peers[id]`, hand the entry to another open socket already
     * identified as the same peer (a standby, see resolveRedundant) -- the peer never left, so no
     * event. Only with no such socket is the peer actually disconnected.
     */
    private releasePeer(id: string, ws: IWS): void {
        if (this.peers.get(id) !== ws) return;
        this.peers.delete(id);

        for (const candidate of this.liveSockets) {
            if (candidate === ws || candidate.readyState !== WebSocket.OPEN) continue;
            const info = this.infoOf(candidate);
            if (info.peerId !== id || info.superseded || info.resolving) continue;
            this.peers.set(id, candidate);
            return;
        }
        this.emit('peer:disconnect', id);
    }

    private handleIncomingMessage(raw: unknown, socket: IWS, onIdentify?: (id: string) => void) {
        // Any real inbound frame is stronger liveness evidence than a control-frame pong --
        // sendHeartbeats() reads this to avoid killing a socket that's actively exchanging
        // application data but happened to lose one ping/pong round-trip (see its own comment).
        this.infoOf(socket).lastMessageAt = Date.now();
        try {
            const payloadString = this.decodePayload(raw);
            const envelope = this.serializer.deserialize(payloadString) as MeshPacket;

            if (envelope.version !== undefined && envelope.version !== WSTransport.PROTOCOL_VERSION) {
                this.logger?.warn(`[WSTransport] Dropping packet with incompatible version: ${envelope.version}. Expected ${WSTransport.PROTOCOL_VERSION}`);
                return;
            }

            const { topic, data, id, type, senderNodeID } = envelope;
            const senderId = senderNodeID;

            // Phase 3: Drop packets from self (Loopback suppression for uncontrolled transport echoes)
            if (senderId === this.nodeID) {
                return;
            }

            if (senderId && onIdentify) {
                onIdentify(senderId);
            }

            if (type === 'RESPONSE' || type === 'RESPONSE_ERROR') {
                const pending = this.pendingRPCs.get(id);
                if (pending) {
                    clearTimeout(pending.timeout);
                    this.pendingRPCs.delete(id);
                    if (type === 'RESPONSE_ERROR') {
                        // The envelope's `error` first, the payload second: the broker sends the
                        // same object in both, but a peer on an older build only fills `data`.
                        pending.reject(errorFromWire(envelope.error ?? data, 'RPC Error'));
                    } else {
                        pending.resolve(data);
                    }
                    return;
                }
            }

            const handlers = this.subscriptions.get(topic) || [];
            for (const handler of handlers) {
                handler(data);
            }
            this.emit('packet', envelope);
        } catch (err: unknown) {
            this.emit('error', err instanceof Error ? err : new Error(String(err)));
        }
    }

    private decodePayload(raw: unknown): string {
        if (typeof raw === 'string') return raw;
        if (Buffer.isBuffer(raw)) return raw.toString('utf-8');
        if (raw instanceof ArrayBuffer || raw instanceof Uint8Array) return new TextDecoder().decode(raw);
        return String(raw);
    }

    private isDraining = false;

    async disconnect(): Promise<void> {
        this.isDraining = true;
        this.logger?.info('[WSTransport] Draining connections...');

        for (const timer of this.reconnectionTimers.values()) {
            clearTimeout(timer);
        }
        this.reconnectionTimers.clear();

        // Wait for in-flight RPCs to finish or timeout
        const start = Date.now();
        while (this.pendingRPCs.size > 0 && Date.now() - start < 5000) {
            await new Promise(r => setTimeout(() => r(undefined), 100));
        }

        if (this.pendingRPCs.size > 0) {
            this.logger?.warn(`[WSTransport] Force closing with ${this.pendingRPCs.size} pending RPCs`);
            for (const pending of this.pendingRPCs.values()) {
                clearTimeout(pending.timeout);
                pending.reject(new Error('Transport disconnected'));
            }
            this.pendingRPCs.clear();
        }

        this.stopHeartbeat();
        for (const ws of this.liveSockets) {
            if (ws.terminate) ws.terminate();
            else ws.close();
        }
        this.peers.clear();

        if (this.wss) {
            this.wss.close();
        }
        if (this.server) {
            await new Promise<void>(resolve => this.server!.close(() => resolve()));
        }
        this.connected = false;
        this.emit('disconnected');
    }

    public static readonly PROTOCOL_VERSION = 1;

    async send(nodeID: string, packet: MeshPacket): Promise<void> {
        if (this.isDraining) {
            //this.logger?.warn(`[WSTransport] Cannot send to ${nodeID}: transport is draining`);
            return;
        }

        let ws = this.peers.get(nodeID);
        if (!ws || ws.readyState !== 1) {
            // Hub and Spoke Proxy Routing
            // If target is not directly connected, route through a connected peer
            if (this.peers.size > 0 && packet.targetNodeID && packet.targetNodeID !== this.nodeID) {
                const path = Array.isArray(packet.meta?.path) ? packet.meta.path as string[] : [];
                const peerEntry = Array.from(this.peers.entries()).find(([peerId, p]) =>
                    p.readyState === 1 && !path.includes(peerId)
                );
                if (peerEntry) {
                    ws = peerEntry[1];
                }
            }

            if (!ws || ws.readyState !== 1) {
                return;
            }
        }

        // Add ourselves to the routing path
        if (packet.meta && Array.isArray(packet.meta.path)) {
            if (!packet.meta.path.includes(this.nodeID)) {
                packet.meta.path.push(this.nodeID);
            }
        }

        // Backpressure: if bufferedAmount is too high, wait
        const MAX_BUFFERED_AMOUNT = 1024 * 1024; // 1MB threshold
        while (ws.bufferedAmount && ws.bufferedAmount > MAX_BUFFERED_AMOUNT) {
            await new Promise(r => setTimeout(() => r(undefined), 50));
        }

        packet.version = WSTransport.PROTOCOL_VERSION;

        const correlationId = (packet.id as string) || randomUUID();
        const buf = this.serializer.serialize({ ...packet, senderNodeID: this.nodeID, id: correlationId });
        ws.send(new TextDecoder().decode(buf));
    }

    async call(nodeID: string, topic: string, data: Record<string, unknown>): Promise<unknown> {
        const id = randomUUID();
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (this.pendingRPCs.has(id)) {
                    this.pendingRPCs.delete(id);
                    reject(new Error(`RPC timeout after ${WSTransport.RPC_TIMEOUT_MS}ms`));
                }
            }, WSTransport.RPC_TIMEOUT_MS);

            this.pendingRPCs.set(id, { resolve, reject, timeout });

            this.send(nodeID, {
                topic,
                data,
                id,
                type: 'REQUEST',
                senderNodeID: this.nodeID,
                timestamp: Date.now()
            }).catch(err => {
                clearTimeout(timeout);
                this.pendingRPCs.delete(id);
                reject(err);
            });
        });
    }

    async publish(topic: string, packet: MeshPacket): Promise<void> {
        // Phase 3: Block REQUEST broadcasts
        if (packet.type === 'REQUEST') {
            this.logger?.warn(`[WSTransport] Cannot broadcast REQUEST packets to topic: ${topic}`);
            return;
        }

        const id = packet.id || `msg_${Math.random().toString(36).substr(2, 9)}`;
        const timestamp = packet.timestamp || Date.now();

        const fullPacket = {
            ...packet,
            topic,
            senderNodeID: this.nodeID,
            version: WSTransport.PROTOCOL_VERSION,
            id,
            timestamp
        };

        const buf = this.serializer.serialize(fullPacket);
        const payload = new TextDecoder().decode(buf);
        for (const ws of this.peers.values()) {
            if (ws.readyState === 1) {
                ws.send(payload);
            }
        }
    }

    /**
     * Dial `url` -- unless it needs no dial: its node is already connected (by any socket, in either
     * direction), a dial to it is already open or in flight, or a redial is already scheduled. That
     * makes this safe to call repeatedly for the same peer, which is how MeshOrchestrator keeps its
     * bootstrap peers connected, and why PEX, bootstrap and supervision dials cannot pile up.
     */
    async connectToPeer(nodeID: string, url: string): Promise<void> {
        if (this.isPeerConnected(nodeID) || !this.needsDial(url)) return;
        return this.internalConnectToPeer(nodeID, url);
    }

    override needsDial(url: string): boolean {
        if (this.isDraining) return false;
        const known = this.urlNode.get(url);
        if (known !== undefined && (known === this.nodeID || this.isPeerConnected(known))) return false;
        return !this.outbound.has(url) && !this.reconnectionTimers.has(url);
    }

    /** The socket that owns each peer's entry -- a standby or a closing socket is not a link. */
    override peerLinks(): readonly PeerLink[] {
        const links: PeerLink[] = [];
        for (const [nodeID, ws] of this.peers) {
            if (ws.readyState !== WebSocket.OPEN) continue;
            const info = this.infoOf(ws);
            links.push({ nodeID, dialedBy: info.dialedBy, openedAt: info.openedAt, lastMessageAt: info.lastMessageAt });
        }
        return links.sort((a, b) => a.nodeID.localeCompare(b.nodeID));
    }

    override isPeerConnected(nodeID: string): boolean {
        const ws = this.peers.get(nodeID);
        return !!ws && ws.readyState === WebSocket.OPEN;
    }

    private async internalConnectToPeer(nodeID: string, url: string, attempt = 0): Promise<void> {
        const line = `[WSTransport] Connecting to peer ${nodeID} at ${url}...`;
        if (attempt === 0) this.logger?.info(line);
        else this.logger?.debug(line);
        return new Promise((resolve, reject) => {
            const key = this.authKey ?? process.env.MESH_KEY;
            const headers: Record<string, string> = {
                [NODE_HEADER]: this.nodeID,
                [INSTANCE_HEADER]: this.instanceId,
            };
            if (key) {
                headers['x-mesh-key'] = key;
                headers['authorization'] = `Bearer ${key}`;
            }
            const ws: IWS = new WebSocket(url, { headers });
            this.outbound.set(url, ws);

            // A bootstrap dial starts under a temporary placeholder id (MeshOrchestrator's
            // `bootstrap_<rand>`) until the peer says who it is -- in its upgrade response, or, from
            // a peer too old to, its first message. currentPeerId tracks whichever key this socket
            // is *actually* filed under in `this.peers` right now, so identifying it and cleaning it
            // up both operate on the same, current key -- not two different ones.
            let currentPeerId = nodeID;
            let remoteNode: string | undefined;
            const info = this.trackSocket(ws, 'self');

            let isAuthFailure = false;

            ws.on('upgrade', (res: unknown) => {
                info.remoteInstance = headerValue(res, INSTANCE_HEADER) || undefined;
                remoteNode = headerValue(res, NODE_HEADER) || undefined;
            });

            ws.on('open', () => {
                this.reconnectFailures.delete(url);
                this.refusalLogged.delete(url);
                this.startHeartbeat();

                if (remoteNode !== undefined) {
                    this.urlNode.set(url, remoteNode);
                    if (remoteNode === this.nodeID) {
                        // Our own address is in the bootstrap list (every node is given every
                        // node's). Nothing to connect to; connectToPeer skips this URL from now on.
                        this.logger?.debug(`[WSTransport] ${url} is this node itself; not connecting`, { internal: true });
                        this.supersede(ws);
                        resolve();
                        return;
                    }
                    currentPeerId = remoteNode;
                }
                this.claimPeer(currentPeerId, ws);
                resolve();
            });

            ws.on('error', (err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                if (msg.includes('401') || msg.includes('403')) {
                    isAuthFailure = true;
                    if (msg.includes('401')) {
                        this.logger?.error(`[WSTransport] Handshake unauthorized (401): authentication key required for peer ${nodeID} at ${url}`);
                    } else if (msg.includes('403')) {
                        this.logger?.error(`[WSTransport] Handshake forbidden (403): invalid authentication key for peer ${nodeID} at ${url}`);
                    }
                }
                if (attempt === 0) reject(err);
            });

            ws.on('message', (data: unknown) => {
                this.handleIncomingMessage(data, ws, (id) => {
                    if (id !== currentPeerId) {
                        // Identified as someone other than the placeholder (or a previous identity)
                        // it was filed under -- move the entry, don't just add a second one. The old
                        // client-side bug here: this only ever *added* peers[id], leaving
                        // peers[<old placeholder>] pointing at the same live socket forever, so
                        // sendHeartbeats() pinged the same connection under two keys at once --
                        // found live as a repeating "bootstrap_XXXXX missed pong, terminating
                        // socket" that never stopped, once every heartbeat tick.
                        if (this.peers.get(currentPeerId) === ws) {
                            this.peers.delete(currentPeerId);
                        }
                        currentPeerId = id;
                        this.urlNode.set(url, id);
                    }
                    // Through claimPeer, never a bare peers.set: another live socket may already
                    // hold this id, and overwriting it is what dropped working links.
                    this.claimPeer(id, ws);
                });
            });

            ws.on('close', (...args: unknown[]) => {
                this.forgetSocket(ws);
                if (this.outbound.get(url) === ws) this.outbound.delete(url);
                this.releasePeer(currentPeerId, ws);

                // Closed in favour of another socket to the same peer, by either end: the peer is
                // still connected, so there is nothing to reconnect.
                if (info.superseded || args[0] === REDUNDANT_CONNECTION_CLOSE) return;
                if (isAuthFailure) return;

                if (args[0] === DUPLICATE_NODE_ID_CLOSE) {
                    // Refused for claiming a nodeID another live process holds there. Not
                    // permanent: before probing existed, a stale socket to this node's own previous
                    // process was refused the same way, and never retried. Retry slowly, and say
                    // why once rather than on every attempt.
                    if (!this.refusalLogged.has(url)) {
                        this.refusalLogged.add(url);
                        this.logger?.error(`[WSTransport] ${url} refused this connection: nodeID "${this.nodeID}" is already connected there from another live process. Give this process its own nodeID. Retrying every ${RECONNECT_BACKOFF_CAP_MS / 1000}s.`);
                    }
                    this.handleReconnection(currentPeerId, url, RECONNECT_BACKOFF_CAP_MS);
                    return;
                }

                // Reconnect under the identity this socket last proved, not the placeholder it
                // started as -- otherwise every reconnect forgets the real nodeID this connection
                // already learned and starts back over as an anonymous bootstrap peer, every time.
                this.handleReconnection(currentPeerId, url);
            });
        });
    }

    /**
     * Schedule a redial of `url`, backing off per URL up to RECONNECT_BACKOFF_CAP_MS, and never
     * giving up while the transport runs -- a peer that is down for an hour is reconnected when it
     * comes back. Skipped when the peer turns out to be connected by then (it dialed us, say).
     */
    private handleReconnection(nodeID: string, url: string, fixedDelayMs?: number): void {
        if (this.isDraining || this.reconnectionTimers.has(url)) return;

        const failures = this.reconnectFailures.get(url) ?? 0;
        this.reconnectFailures.set(url, failures + 1);
        if (failures + 1 === RECONNECT_WARN_AFTER) {
            this.logger?.warn(`[WSTransport] Still cannot reach peer ${nodeID} at ${url} after ${RECONNECT_WARN_AFTER} attempts; retrying every ~${RECONNECT_BACKOFF_CAP_MS / 1000}s until it answers`);
        }

        const baseDelay = fixedDelayMs ?? Math.min(RECONNECT_BACKOFF_CAP_MS, Math.pow(2, failures) * 1000);
        // Add 0-25% jitter
        const delay = baseDelay + Math.random() * 0.25 * baseDelay;

        const timer = setTimeout(() => {
            this.reconnectionTimers.delete(url);
            const known = this.urlNode.get(url);
            if (this.isPeerConnected(nodeID) || (known !== undefined && this.isPeerConnected(known))) {
                this.reconnectFailures.delete(url);
                return;
            }
            if (this.isDraining || this.outbound.has(url)) return;
            this.internalConnectToPeer(nodeID, url, failures + 1).catch(() => { });
        }, delay);
        this.reconnectionTimers.set(url, timer);
        timer.unref();
    }

    /** Start tracking a new socket: its SocketInfo, its keepalive, and liveSockets. */
    private trackSocket(ws: IWS, dialedBy: SocketInfo['dialedBy']): SocketInfo {
        const info: SocketInfo = { dialedBy, awaitingPong: false, lastMessageAt: Date.now(), openedAt: Date.now() };
        this.socketInfo.set(ws, info);
        this.liveSockets.add(ws);

        ws.on('pong', () => {
            info.awaitingPong = false;
            if (info.pingTimeoutTimer) {
                clearTimeout(info.pingTimeoutTimer);
                info.pingTimeoutTimer = undefined;
            }
        });
        return info;
    }

    /** Every socket is tracked from creation; this only covers one that somehow was not. */
    private infoOf(ws: IWS): SocketInfo {
        let info = this.socketInfo.get(ws);
        if (info === undefined) {
            info = { dialedBy: 'remote', awaitingPong: false, lastMessageAt: Date.now(), openedAt: Date.now() };
            this.socketInfo.set(ws, info);
        }
        return info;
    }

    private forgetSocket(ws: IWS): void {
        this.liveSockets.delete(ws);
        this.cleanupSocketKeepalive(ws);
    }

    private cleanupSocketKeepalive(ws: IWS): void {
        const info = this.infoOf(ws);
        if (info.pingTimeoutTimer) {
            clearTimeout(info.pingTimeoutTimer);
            info.pingTimeoutTimer = undefined;
        }
    }

    /** Real inbound data more recent than a full ping interval is stronger proof of life than one
     *  missed pong (see terminatePeerForPingFailure's own comment) -- shared by both places that
     *  decide whether a missed pong/timeout is real. */
    private hasRecentTraffic(ws: IWS): boolean {
        return (Date.now() - this.infoOf(ws).lastMessageAt) < this.pingIntervalMs;
    }

    /**
     * The one place a ping failure actually kills a connection, so `this.peers` is always
     * consistent with "will this be pinged again" the instant we decide to terminate -- not
     * whenever (if ever) the async `ws.on('close')` handler happens to fire.
     *
     * A socket stuck in a half-handshaked state (an unidentified `bootstrap_<rand>` entry that
     * never completed identification, in particular) can fail to emit `'close'` at all from
     * `ws.terminate()` -- found live: node-1 relaying `[WSTransport] Peer bootstrap_XXXXX missed
     * pong, terminating socket` on every single heartbeat tick for 5+ minutes straight, the exact
     * same peer id never changing, because the entry was never actually removed from `this.peers`
     * between calls -- sendHeartbeats() just kept re-discovering and re-killing the same zombie.
     * Deleting it here, synchronously, means the next tick has nothing left to re-kill regardless
     * of whether the socket's own 'close' event ever fires.
     */
    private terminatePeerForPingFailure(peerId: string, ws: IWS, reason: string): void {
        this.logger?.warn(`[WSTransport] Peer ${peerId} ${reason}`);
        this.cleanupSocketKeepalive(ws);
        this.releasePeer(peerId, ws);
        if (ws.terminate) ws.terminate();
        else if (ws.close) ws.close();
    }

    /**
     * Every open socket, not only the ones in `peers`: a standby or a socket that never identified is
     * still a connection, and one that has died must be found and closed like any other.
     */
    private sendHeartbeats(): void {
        for (const ws of this.liveSockets) {
            if (ws.readyState !== 1) continue;

            const socket = this.infoOf(ws);
            const peerId = socket.peerId ?? 'unidentified';
            if (socket.awaitingPong) {
                // A pong is one control-frame round-trip on the same connection real request/
                // response traffic flows over -- under sustained load it can lose a single race
                // against that traffic without the connection actually being dead. Real inbound
                // data more recent than a full ping interval is stronger proof of life than one
                // missed pong, so don't kill a socket that's demonstrably still exchanging
                // messages; just fall through and send it a fresh ping this tick instead.
                if (!this.hasRecentTraffic(ws)) {
                    this.terminatePeerForPingFailure(peerId, ws, 'missed pong, terminating socket');
                    continue;
                }
                socket.awaitingPong = false;
            }

            socket.awaitingPong = true;

            if (socket.pingTimeoutTimer) {
                clearTimeout(socket.pingTimeoutTimer);
            }

            socket.pingTimeoutTimer = setTimeout(() => {
                if (!socket.awaitingPong) return;
                socket.pingTimeoutTimer = undefined;
                // Same escape hatch as the missed-pong branch above -- this timer fires
                // independently of sendHeartbeats()'s own tick, and previously had no such check
                // at all: a socket that was demonstrably still exchanging real traffic got killed
                // anyway the moment this specific ping/pong round-trip alone was slow.
                if (this.hasRecentTraffic(ws)) {
                    socket.awaitingPong = false;
                    return;
                }
                this.terminatePeerForPingFailure(peerId, ws, `ping timeout (${this.pingTimeoutMs}ms), terminating socket`);
            }, this.pingTimeoutMs);

            socket.pingTimeoutTimer.unref();

            if (ws.ping) {
                try {
                    ws.ping();
                } catch (err) {
                    this.terminatePeerForPingFailure(peerId, ws, `error sending ping, terminating socket: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
        }
    }

    private startHeartbeat(): void {
        if (this.heartbeatTimer) return;
        this.heartbeatTimer = setInterval(() => {
            this.sendHeartbeats();
        }, this.pingIntervalMs);
        if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
    }

    private stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }
        for (const ws of this.liveSockets) {
            this.cleanupSocketKeepalive(ws);
        }
    }
}
