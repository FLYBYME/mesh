import { BaseTransport } from '../BaseTransport.js';
import { BaseSerializer } from '../../serializers/BaseSerializer.js';
import type { TransportConnectOptions, IWS, IWSServer, MeshPacket } from '../../interfaces/IMeshNetwork.js';
import http from 'node:http';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { nanoid } from 'nanoid';
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
    private reconnectAttempts = 0;
    private static readonly MAX_RECONNECT_ATTEMPTS = 10;
    private heartbeatTimer?: NodeJS.Timeout;
    private reconnectionTimers = new Set<NodeJS.Timeout>();

    public pingIntervalMs: number;
    public pingTimeoutMs: number;

    constructor(serializer: BaseSerializer, port = 0, host: string = '0.0.0.0', options: WSTransportOptions = {}) {
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
        if (opts.authKey !== undefined) this.authKey = opts.authKey;
        else if (opts.authToken !== undefined) this.authKey = opts.authToken;
        else if (!this.authKey && process.env.MESH_KEY) this.authKey = process.env.MESH_KEY;

        if (opts.sharedServer) {
            this.logger?.debug(`[WSTransport] Attaching to shared server...`);
            return this.attachToSharedServer(opts.sharedServer as http.Server);
        }

        this.logger?.info(`[WSTransport] Starting standalone server on port ${this.port}...`);
        return this.startNodeServer();
    }

    private isLoopbackAddress(addr?: string): boolean {
        if (!addr) return false;
        return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1' || addr === 'localhost';
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
        this.wss.on('connection', (ws: IWS) => {
            let peerId: string | null = null;
            this.setupSocketKeepalive(ws, () => peerId);

            ws.on('message', (raw: unknown) => {
                this.handleIncomingMessage(raw, ws, (id) => {
                    if (!this.peers.has(id)) {
                        this.peers.set(id, ws);
                        this.emit('peer:connect', id);
                    }
                    peerId = id;
                });
            });

            ws.on('close', () => {
                this.cleanupSocketKeepalive(ws);
                if (peerId) {
                    this.peers.delete(peerId);
                    this.emit('peer:disconnect', peerId);
                }
            });
        });
    }

    private handleIncomingMessage(raw: unknown, socket: IWS, onIdentify?: (id: string) => void) {
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
                        const errorMsg = (data && typeof data === 'object' && 'message' in data) ? String((data as Record<string, unknown>).message) : 'RPC Error';
                        pending.reject(new Error(errorMsg));
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

        for (const timer of this.reconnectionTimers) {
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
        for (const ws of this.peers.values()) {
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

        const correlationId = (packet.id as string) || nanoid();
        const buf = this.serializer.serialize({ ...packet, senderNodeID: this.nodeID, id: correlationId });
        ws.send(new TextDecoder().decode(buf));
    }

    async call(nodeID: string, topic: string, data: Record<string, unknown>): Promise<unknown> {
        const id = nanoid();
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

    async connectToPeer(nodeID: string, url: string): Promise<void> {
        return this.internalConnectToPeer(nodeID, url);
    }

    override isPeerConnected(nodeID: string): boolean {
        const ws = this.peers.get(nodeID);
        return !!ws && ws.readyState === WebSocket.OPEN;
    }

    private async internalConnectToPeer(nodeID: string, url: string, attempt = 0): Promise<void> {
        this.logger?.info(`[WSTransport] Connecting to peer ${nodeID} at ${url}...`);
        return new Promise((resolve, reject) => {
            const key = this.authKey ?? process.env.MESH_KEY;
            const ws = (key
                ? new WebSocket(url, {
                    headers: {
                        'x-mesh-key': key,
                        'authorization': `Bearer ${key}`
                    }
                })
                : new WebSocket(url)) as IWS;

            this.setupSocketKeepalive(ws, () => nodeID);

            let isAuthFailure = false;

            ws.on('open', () => {
                this.reconnectAttempts = 0;
                this.peers.set(nodeID, ws);
                this.emit('peer:connect', nodeID);
                this.startHeartbeat();
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
                    this.peers.set(id, ws);
                });
            });

            ws.on('close', () => {
                this.cleanupSocketKeepalive(ws);
                if (this.peers.has(nodeID)) {
                    this.peers.delete(nodeID);
                    this.emit('peer:disconnect', nodeID);
                }
                if (!isAuthFailure) {
                    this.handleReconnection(nodeID, url);
                }
            });
        });
    }

    private handleReconnection(nodeID: string, url: string) {
        if (this.isDraining) return;
        if (this.reconnectAttempts >= WSTransport.MAX_RECONNECT_ATTEMPTS) {
            this.logger?.error(`Max reconnection attempts reached for node ${nodeID}`);
            return;
        }

        const baseDelay = Math.min(30000, Math.pow(2, this.reconnectAttempts) * 1000);
        // Add 0-25% jitter
        const jitter = Math.random() * 0.25 * baseDelay;
        const delay = baseDelay + jitter;

        this.reconnectAttempts++;

        const timer = setTimeout(() => {
            this.reconnectionTimers.delete(timer);
            this.internalConnectToPeer(nodeID, url, this.reconnectAttempts).catch(() => { });
        }, delay);
        this.reconnectionTimers.add(timer);
        timer.unref();
    }

    private setupSocketKeepalive(ws: IWS, getPeerId: () => string | null): void {
        const socket = ws as any;
        socket.isAlive = true;
        socket.awaitingPong = false;

        ws.on('pong', () => {
            socket.isAlive = true;
            socket.awaitingPong = false;
            if (socket._pingTimeoutTimer) {
                clearTimeout(socket._pingTimeoutTimer);
                socket._pingTimeoutTimer = undefined;
            }
        });
    }

    private cleanupSocketKeepalive(ws: IWS): void {
        const socket = ws as any;
        if (socket._pingTimeoutTimer) {
            clearTimeout(socket._pingTimeoutTimer);
            socket._pingTimeoutTimer = undefined;
        }
    }

    private sendHeartbeats(): void {
        for (const [peerId, ws] of this.peers.entries()) {
            if (ws.readyState !== 1) continue;

            const socket = ws as any;
            if (socket.awaitingPong) {
                this.logger?.warn(`[WSTransport] Peer ${peerId} missed pong, terminating socket`);
                this.cleanupSocketKeepalive(ws);
                if (ws.terminate) ws.terminate();
                else if (ws.close) ws.close();
                continue;
            }

            socket.awaitingPong = true;
            socket.isAlive = false;

            if (socket._pingTimeoutTimer) {
                clearTimeout(socket._pingTimeoutTimer);
            }

            socket._pingTimeoutTimer = setTimeout(() => {
                if (socket.awaitingPong) {
                    this.logger?.warn(`[WSTransport] Peer ${peerId} ping timeout (${this.pingTimeoutMs}ms), terminating socket`);
                    socket._pingTimeoutTimer = undefined;
                    if (ws.terminate) ws.terminate();
                    else if (ws.close) ws.close();
                }
            }, this.pingTimeoutMs);

            if (socket._pingTimeoutTimer.unref) {
                socket._pingTimeoutTimer.unref();
            }

            if (ws.ping) {
                try {
                    ws.ping();
                } catch (err) {
                    this.logger?.warn(`[WSTransport] Error sending ping to ${peerId}: ${err instanceof Error ? err.message : String(err)}`);
                    this.cleanupSocketKeepalive(ws);
                    if (ws.terminate) ws.terminate();
                    else if (ws.close) ws.close();
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
        for (const ws of this.peers.values()) {
            this.cleanupSocketKeepalive(ws);
        }
    }
}
