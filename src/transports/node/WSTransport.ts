import { BaseTransport } from '../BaseTransport.js';
import { BaseSerializer } from '../../serializers/BaseSerializer.js';
import type { TransportConnectOptions, IWS, IWSServer, MeshPacket } from '../../interfaces/IMeshNetwork.js';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { nanoid } from 'nanoid';
import { ILogger } from '../../interfaces/ILogger.js';
import { AuthHandshakeManager } from '../../core/AuthHandshakeManager.js';
import { IServiceRegistry } from '../../interfaces/IServiceRegistry.js';

interface PendingRPC {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
    timeout: NodeJS.Timeout;
}

interface WSPeerState {
    ws: IWS;
    nodeID: string | null;
    isAuthenticated: boolean;
    challenge?: string;
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
    private peerStates = new Set<WSPeerState>();
    public logger?: ILogger;
    public registry?: IServiceRegistry;
    public privateKey?: string;

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
    }

    async connect(opts: TransportConnectOptions): Promise<void> {
        this.nodeID = opts.nodeID || this.nodeID;
        this.logger = opts.logger;
        this.registry = opts.registry;
        this.privateKey = opts.privateKey;

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
            const peerState: WSPeerState = {
                ws,
                nodeID: null,
                isAuthenticated: false
            };
            this.peerStates.add(peerState);

            // Initiate challenge
            const challenge = AuthHandshakeManager.generateChallenge();
            peerState.challenge = challenge;

            const authPacket: MeshPacket = {
                id: nanoid(),
                topic: '$auth.challenge',
                type: 'AUTH',
                senderNodeID: this.nodeID,
                timestamp: Date.now(),
                data: { type: 'challenge', challenge }
            } as MeshPacket;

            ws.send(new TextDecoder().decode(this.serializer.serialize(authPacket)));

            ws.on('message', (raw: unknown) => {
                this.handleIncomingMessage(raw, peerState, (id) => {
                    if (!this.peers.has(id)) {
                        this.peers.set(id, ws);
                        this.emit('peer:connect', id);
                    }
                    peerState.nodeID = id;
                });
            });

            ws.on('close', () => {
                this.peerStates.delete(peerState);
                if (peerState.nodeID) {
                    this.peers.delete(peerState.nodeID);
                    this.emit('peer:disconnect', peerState.nodeID);
                }
            });

            ws.on('pong', () => { });
        });
    }

    private async handleIncomingMessage(raw: unknown, peerState: WSPeerState, onIdentify?: (id: string) => void) {
        try {
            const payloadString = this.decodePayload(raw);
            const envelope = this.serializer.deserialize(payloadString) as MeshPacket;

            if (envelope.version !== undefined && envelope.version !== WSTransport.PROTOCOL_VERSION) {
                this.logger?.warn(`[WSTransport] Dropping packet with incompatible version: ${envelope.version}. Expected ${WSTransport.PROTOCOL_VERSION}`);
                return;
            }

            const { topic, data, id, type, senderNodeID } = envelope;
            const senderId = senderNodeID;

            // Authentication Handshake
            if (type === 'AUTH') {
                const authData = data as { type: string; challenge?: string; response?: string; nodeID?: string };
                
                if (authData.type === 'challenge' && authData.challenge) {
                    if (!this.privateKey) {
                        this.logger?.error('[WSTransport] Cannot respond to auth challenge: private key missing');
                        return;
                    }
                    const response = await AuthHandshakeManager.createResponse(authData.challenge, this.privateKey);
                    
                    // Get our public key to include in response for first-contact discovery
                    const myNode = this.registry?.getNode(this.nodeID);
                    const publicKey = myNode?.publicKey;

                    const responsePacket: MeshPacket = {
                        id: nanoid(),
                        topic: '$auth.response',
                        type: 'AUTH',
                        senderNodeID: this.nodeID,
                        timestamp: Date.now(),
                        data: { 
                            type: 'response', 
                            response, 
                            nodeID: this.nodeID, 
                            challenge: authData.challenge,
                            publicKey // Include public key for verification
                        }
                    } as MeshPacket;
                    peerState.ws.send(new TextDecoder().decode(this.serializer.serialize(responsePacket)));
                    return;
                }

                if (authData.type === 'response' && authData.response && authData.nodeID && authData.challenge) {
                    if (authData.challenge !== peerState.challenge) {
                        this.logger?.warn(`[WSTransport] Auth failed: challenge mismatch for node ${authData.nodeID}`);
                        peerState.ws.close();
                        return;
                    }

                    let publicKey = this.registry?.getNode(authData.nodeID)?.publicKey;
                    
                    // If not in registry, try to use the one provided in the auth packet
                    if (!publicKey && (authData as any).publicKey) {
                        publicKey = (authData as any).publicKey;
                        this.logger?.debug(`[WSTransport] Using provided public key for new node ${authData.nodeID}`);
                        
                        // Optionally: verify if this public key is trusted/allowed
                        // For now, we trust discovery but verify the signature
                        this.registry?.registerNode({
                            nodeID: authData.nodeID,
                            publicKey: publicKey as string,
                            type: 'node',
                            namespace: 'default',
                            addresses: [],
                            services: [],
                            nodeSeq: 0,
                            hostname: 'unknown',
                            timestamp: Date.now(),
                            available: true,
                            trustLevel: 'public',
                            capabilities: {},
                            metadata: {},
                            pid: 0
                        });
                    }

                    if (!publicKey) {
                        this.logger?.warn(`[WSTransport] Auth failed: public key not found for node ${authData.nodeID}`);
                        peerState.ws.close();
                        return;
                    }

                    const isValid = await AuthHandshakeManager.verifyResponse(authData.response, authData.challenge, publicKey);
                    if (isValid) {
                        peerState.isAuthenticated = true;
                        peerState.nodeID = authData.nodeID;
                        if (onIdentify) onIdentify(authData.nodeID);
                        this.logger?.info(`[WSTransport] Node ${authData.nodeID} authenticated successfully`);
                    } else {
                        this.logger?.warn(`[WSTransport] Auth failed: invalid signature from node ${authData.nodeID}`);
                        peerState.ws.close();
                    }
                    return;
                }
            }

            // Drop non-AUTH packets from unauthenticated peers
            if (!peerState.isAuthenticated) {
                return;
            }

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

            // Enrich packet with auth metadata for interceptors
            envelope.meta = { ...envelope.meta, authenticatedNodeID: peerState.nodeID };

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
        this.peerStates.clear();

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

    private async internalConnectToPeer(nodeID: string, url: string, attempt = 0): Promise<void> {
        this.logger?.info(`[WSTransport] Connecting to peer ${nodeID} at ${url}...`);
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(url) as IWS;

            const peerState: WSPeerState = {
                ws,
                nodeID: nodeID,
                isAuthenticated: false
            };
            this.peerStates.add(peerState);

            ws.on('open', () => {
                this.reconnectAttempts = 0;

                // Initiate mutual auth: Client also challenges the Server
                const challenge = AuthHandshakeManager.generateChallenge();
                peerState.challenge = challenge;

                const authPacket: MeshPacket = {
                    id: nanoid(),
                    topic: '$auth.challenge',
                    type: 'AUTH',
                    senderNodeID: this.nodeID,
                    timestamp: Date.now(),
                    data: { type: 'challenge', challenge }
                } as MeshPacket;

                ws.send(new TextDecoder().decode(this.serializer.serialize(authPacket)));

                resolve();
            });

            ws.on('error', (err: unknown) => {
                if (attempt === 0) reject(err);
            });

            ws.on('message', (data: unknown) => {
                this.handleIncomingMessage(data, peerState, (id) => {
                    this.peers.set(id, ws);
                    this.emit('peer:connect', id);
                });
            });

            ws.on('close', () => {
                this.peerStates.delete(peerState);
                if (peerState.nodeID) {
                    this.peers.delete(peerState.nodeID);
                    this.emit('peer:disconnect', peerState.nodeID);
                }
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
