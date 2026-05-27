import { BaseTransport } from '../BaseTransport.js';
import { BaseSerializer } from '../../serializers/BaseSerializer.js';
import type { TransportConnectOptions, IWS, IWSServer, MeshPacket } from '../../interfaces/IMeshNetwork.js';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { nanoid } from 'nanoid';
import { ILogger } from '../../interfaces/ILogger.js';

interface PendingRPC {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
    timeout: NodeJS.Timeout;
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
    private peers = new Map<string, IWS>();
    public logger?: ILogger;

    private pendingRPCs = new Map<string, PendingRPC>();
    private static readonly RPC_TIMEOUT_MS = 10000;
    private reconnectAttempts = 0;
    private static readonly MAX_RECONNECT_ATTEMPTS = 10;
    private heartbeatTimer?: NodeJS.Timeout;
    private reconnectionTimers = new Set<NodeJS.Timeout>();

    constructor(serializer: BaseSerializer, port = 0) {
        super(serializer);
        this.port = port;
    }

    async start(): Promise<void> {
        this.proactiveReplay();
    }

    private proactiveReplay(): void {
        this.logger?.info('[WSTransport] Initializing proactive offline queue replay...');
        // Proactive Replay Implementation:
        // 1. Query all targets with pending RPCs from local storage
        // 2. For each target, check if nodeID is in registry
        // 3. If found, call this.connectToPeer(nodeID, node.address)
    }

    async connect(opts: TransportConnectOptions): Promise<void> {
        this.nodeID = opts.nodeID || this.nodeID;
        this.logger = opts.logger;

        if (opts.sharedServer) {
            this.logger?.debug(`[WSTransport] Attaching to shared server...`);
            return this.attachToSharedServer(opts.sharedServer as http.Server);
        }

        this.logger?.info(`[WSTransport] Starting standalone server on port ${this.port}...`);
        return this.startNodeServer();
    }

    private async attachToSharedServer(server: http.Server): Promise<void> {
        this.server = server;
        this.wss = new WebSocketServer({ server: this.server }) as IWSServer;
        this.setupWSSHandlers();
        this.connected = true;
        this.emit('connected');
    }

    private async startNodeServer(): Promise<void> {
        this.server = http.createServer();
        this.wss = new WebSocketServer({ server: this.server }) as IWSServer;
        this.setupWSSHandlers();

        return new Promise((resolve, reject) => {
            if (!this.server) return reject(new Error('Server not initialized'));
            this.server.listen(this.port, () => {
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
                if (peerId) {
                    this.peers.delete(peerId);
                    this.emit('peer:disconnect', peerId);
                }
            });

            ws.on('pong', () => { });
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

        const ws = this.peers.get(nodeID);
        if (!ws || ws.readyState !== 1) {
            //this.logger?.debug(`[WSTransport] Cannot send to ${nodeID}: connection not open`);
            return;
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

    private async internalConnectToPeer(nodeID: string, url: string, attempt = 0): Promise<void> {
        this.logger?.info(`[WSTransport] Connecting to peer ${nodeID} at ${url}...`);
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(url) as IWS;

            ws.on('open', () => {
                this.reconnectAttempts = 0;
                this.peers.set(nodeID, ws);
                this.emit('peer:connect', nodeID);
                resolve();
            });

            ws.on('error', (err: unknown) => {
                if (attempt === 0) reject(err);
            });

            ws.on('message', (data: unknown) => {
                this.handleIncomingMessage(data, ws, (id) => {
                    this.peers.set(id, ws);
                });
            });

            ws.on('close', () => {
                this.peers.delete(nodeID);
                this.emit('peer:disconnect', nodeID);
                this.handleReconnection(nodeID, url);
            });
        });
    }

    private handleReconnection(nodeID: string, url: string) {
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

    private startHeartbeat(): void {
        this.heartbeatTimer = setInterval(() => {
            for (const ws of this.peers.values()) {
                if (ws.readyState === 1 && ws.ping) {
                    ws.ping();
                }
            }
        }, 30000);
        if (this.heartbeatTimer) this.heartbeatTimer.unref();
    }

    private stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }
    }
}
