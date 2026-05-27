import { BaseTransport } from '../BaseTransport.js';
import { BaseSerializer } from '../../serializers/BaseSerializer.js';
import type { TransportConnectOptions, MeshPacket } from '../../interfaces/IMeshNetwork.js';
import { nanoid } from 'nanoid';
import { OfflineStorageEngine } from '../../utils/OfflineStorageEngine.js';
import { ILogger } from '../../interfaces/ILogger.js';


interface PendingRPC {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
    timeout: NodeJS.Timeout;
}

/**
 * BrowserWebSocketTransport — Strict WebSocket transport for the browser.
 * Refactored to extend BaseTransport for Mesh compatibility.
 */
export class BrowserWebSocketTransport extends BaseTransport {
    public readonly protocol = 'ws';
    public readonly version = 1;

    private ws: WebSocket | null = null;
    private peers = new Map<string, WebSocket>();
    public logger?: ILogger;

    private pendingRPCs = new Map<string, PendingRPC>();
    private static readonly RPC_TIMEOUT_MS = 10000;
    private reconnectAttempts = 0;
    private static readonly MAX_RECONNECT_ATTEMPTS = 10;
    private offlineStorage = new OfflineStorageEngine();
    private reconnectionTimers = new Set<NodeJS.Timeout>();

    constructor(serializer: BaseSerializer) {
        super(serializer);
    }

    async connect(opts: TransportConnectOptions): Promise<void> {
        this.nodeID = opts.nodeID || this.nodeID;
        this.logger = opts.logger;
        const url = opts.url;

        await this.offlineStorage.init();

        if (url) {
            await this.internalConnectToPeer('gateway', url);
        }

        this.connected = true;
        this.emit('connected');
    }

    async disconnect(): Promise<void> {
        for (const timer of this.reconnectionTimers) {
            clearTimeout(timer);
        }
        this.reconnectionTimers.clear();

        for (const pending of this.pendingRPCs.values()) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('Transport disconnected'));
        }
        this.pendingRPCs.clear();

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        for (const ws of this.peers.values()) {
            ws.close();
        }
        this.peers.clear();
        this.connected = false;
        this.emit('disconnected');
    }

    async send(nodeID: string, packet: MeshPacket): Promise<void> {
        const ws = this.peers.get(nodeID) || this.ws;

        if (!ws || ws.readyState !== 1) {
            if (packet.type === 'REQUEST') {
                await this.offlineStorage.queue({
                    id: (packet.id as string) || nanoid(),
                    targetId: nodeID,
                    topic: packet.topic as string,
                    data: packet.data as Record<string, unknown>,
                    timestamp: Date.now()
                });
                return;
            }
            //this.logger?.debug(`[WSTransport] Cannot send to node ${nodeID}: connection not open`);
            return;
        }

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
                    reject(new Error(`RPC timeout after ${BrowserWebSocketTransport.RPC_TIMEOUT_MS}ms`));
                }
            }, BrowserWebSocketTransport.RPC_TIMEOUT_MS);
            this.pendingRPCs.set(id, { resolve, reject, timeout });

            this.send(nodeID, { topic, data, id, type: 'REQUEST', senderNodeID: this.nodeID, timestamp: Date.now() }).catch(err => {
                clearTimeout(timeout);
                this.pendingRPCs.delete(id);
                reject(err);
            });
        });
    }

    async publish(topic: string, packet: MeshPacket): Promise<void> {
        // Block REQUEST broadcasts
        if (packet.type === 'REQUEST') {
            this.logger?.warn(`[WSTransport] Cannot broadcast REQUEST packets to topic: ${topic}`);
            return;
        }

        const buf = this.serializer.serialize(packet);
        const payload = new TextDecoder().decode(buf);
        if (this.ws && this.ws.readyState === 1) {
            this.ws.send(payload);
        }
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
        return new Promise((resolve, reject) => {
            try {
                const ws = new WebSocket(url);

                ws.onopen = () => {
                    this.reconnectAttempts = 0;
                    if (nodeID === 'gateway') this.ws = ws;
                    this.peers.set(nodeID, ws);
                    this.emit('peer:connect', nodeID);
                    this.replayQueuedRPCs(nodeID);
                    resolve();
                };

                ws.onerror = (err: Event | unknown) => {
                    if (attempt === 0) reject(err);
                };

                ws.onmessage = (event: MessageEvent) => {
                    this.handleIncomingMessage(event.data, ws);
                };

                ws.onclose = () => {
                    if (nodeID === 'gateway') this.ws = null;
                    this.peers.delete(nodeID);
                    this.emit('peer:disconnect', nodeID);
                    this.handleReconnection(nodeID, url);
                };
            } catch (err) {
                reject(err);
            }
        });
    }

    private handleIncomingMessage(raw: unknown, _socket: WebSocket) {
        try {
            const envelope = this.serializer.deserialize(raw as string | Uint8Array) as MeshPacket;
            const { topic, data, id, type, senderNodeID } = envelope;

            if (senderNodeID && !this.peers.has(senderNodeID) && senderNodeID !== this.nodeID) {
                this.peers.set(senderNodeID, _socket);
                this.emit('peer:connect', senderNodeID);
            }

            if (type === 'RESPONSE' || type === 'RESPONSE_ERROR') {
                const pending = this.pendingRPCs.get(id);
                if (pending) {
                    clearTimeout(pending.timeout);
                    this.pendingRPCs.delete(id);
                    if (envelope.type === 'RESPONSE_ERROR') {
                        pending.reject(new Error(envelope.error?.message || 'RPC Error'));
                    } else if (envelope.type === 'RESPONSE') {
                        pending.resolve(envelope.data);
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

    private async replayQueuedRPCs(nodeID: string) {
        const queued = await this.offlineStorage.getAll();
        for (const rpc of queued) {
            if (rpc.targetId === nodeID) {
                this.send(nodeID, {
                    id: rpc.id,
                    topic: rpc.topic,
                    data: rpc.data,
                    type: 'REQUEST',
                    senderNodeID: this.nodeID,
                    timestamp: rpc.timestamp
                }).then(() => {
                    this.offlineStorage.remove(rpc.id);
                }).catch(() => { });
            }
        }
    }

    private handleReconnection(nodeID: string, url: string) {
        if (this.reconnectAttempts >= BrowserWebSocketTransport.MAX_RECONNECT_ATTEMPTS) {
            this.logger?.error(`Max reconnection attempts reached for node ${nodeID}`);
            return;
        }

        const delay = Math.min(30000, Math.pow(2, this.reconnectAttempts) * 1000);
        this.reconnectAttempts++;

        const timer = setTimeout(() => {
            this.reconnectionTimers.delete(timer);
            this.internalConnectToPeer(nodeID, url, this.reconnectAttempts).catch(() => { });
        }, delay);
        this.reconnectionTimers.add(timer);
    }
}

export { BrowserWebSocketTransport as WSTransport };
