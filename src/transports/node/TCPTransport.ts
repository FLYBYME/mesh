import { BaseTransport } from '../BaseTransport.js';
import { BaseSerializer } from '../../serializers/BaseSerializer.js';
import { type PeerState, type TransportConnectOptions, type INodeSocket, WirePacketType, MeshPacket } from '../../interfaces/IMeshNetwork.js';
import { TCPFrameCodec } from '../helpers/TCPFrameCodec.js';
import { TCPAuthHandler } from '../helpers/TCPAuthHandler.js';
import { IsomorphicCrypto } from '../../utils/Crypto.js';
import tls from 'node:tls';
import { IServiceRegistry } from '../../interfaces/IServiceRegistry.js';
import { ILogger } from '../../interfaces/ILogger.js';

/**
 * TCPTransport — Node.js implementation using 'node:tls' for mTLS.
 */
export class TCPTransport extends BaseTransport {
    readonly protocol = 'tls'; // Renamed from tcp to indicate mTLS
    public static readonly PROTOCOL_VERSION = 1;
    public readonly version = 1;
    public server: tls.Server | null = null;
    public peers = new Map<string, PeerState>();
    private authHandler: TCPAuthHandler;

    public privateKey?: string;
    public registry?: IServiceRegistry;
    public logger?: ILogger;

    public tlsOptions?: tls.TlsOptions;

    constructor(serializer: BaseSerializer) {
        super(serializer);
        this.authHandler = new TCPAuthHandler(this);
    }

    getNodeID(): string {
        return this.nodeID;
    }

    async connect(opts: TransportConnectOptions): Promise<void> {
        this.nodeID = opts.nodeID;
        this.logger = opts.logger;
        this.privateKey = opts.privateKey;
        this.registry = opts.registry;
        this.tlsOptions = opts.tls as tls.TlsOptions | undefined;

        if (!this.tlsOptions || !this.tlsOptions.key || !this.tlsOptions.cert) {
            this.logger?.warn('[TCPTransport] mTLS options missing. Falling back to insecure TLS (NOT RECOMMENDED).');
        }

        const port = opts.port || 4000;

        return new Promise((resolve, reject) => {
            const serverOptions: tls.TlsOptions = {
                ...this.tlsOptions,
                requestCert: true,
                rejectUnauthorized: true, // STRICT mTLS ENFORCEMENT
            };

            this.server = tls.createServer(serverOptions, (socket: tls.TLSSocket) => this.handleConnection(socket as unknown as INodeSocket));
            this.server.on('error', (err: Error) => {
                this.emit('error', err);
                reject(err);
            });
            this.server.listen(port, () => {
                this.connected = true;
                this.emit('connected');
                resolve();
            });
        });
    }

    async disconnect(): Promise<void> {
        for (const peer of this.peers.values()) {
            this.stopHeartbeat(peer);
            (peer.socket as INodeSocket).destroy();
        }
        this.peers.clear();
        return new Promise((resolve) => {
            if (this.server) this.server.close(() => {
                this.connected = false;
                this.emit('disconnected');
                resolve();
            });
            else {
                this.connected = false;
                resolve();
            }
        });
    }

    async send(nodeID: string, packet: MeshPacket): Promise<void> {
        const peer = this.peers.get(nodeID);
        if (!peer || !peer.isAuthenticated) throw new Error(`Target node ${nodeID} is not connected or authenticated`);

        packet.version = TCPTransport.PROTOCOL_VERSION;

        const type = (packet.type === 'RESPONSE' || packet.type === 'RESPONSE_ERROR') ? WirePacketType.RPC_RES : WirePacketType.RPC_REQ;
        const payload = this.serializer.serialize(packet);
        const msgID = (packet.id as string || '0000000000000000').slice(0, 16).padEnd(16, '0');

        const frame = TCPFrameCodec.encode(type, msgID, payload);
        const socket = peer.socket as INodeSocket;
        const canWrite = socket.write(frame);

        if (!canWrite) {
            peer.isChoked = true;
            await new Promise<void>((resolve) => {
                socket.once('drain', () => {
                    peer.isChoked = false;
                    resolve();
                });
            });
        }
    }

    async publish(topic: string, data: unknown): Promise<void> {
        // Phase 3: Block REQUEST broadcasts
        const dataObj = data as Record<string, unknown> | null;
        if (dataObj && typeof dataObj === 'object' && 'type' in dataObj && dataObj.type === 'REQUEST') {
            this.logger?.warn(`[TCPTransport] Cannot broadcast REQUEST packets to topic: ${topic}`);
            return;
        }

        const payload = this.serializer.serialize({ topic, data, senderNodeID: this.nodeID, type: 'EVENT' });
        const msgID = '0000000000000000';
        for (const peer of this.peers.values()) {
            if (peer.isAuthenticated) {
                const frame = TCPFrameCodec.encode(WirePacketType.RPC_REQ, msgID, payload);
                (peer.socket as INodeSocket).write(frame);
            }
        }
    }

    public allowedCIDRs: string[] = [];

    private checkIPAllowed(ip: string): boolean {
        // Basic CIDR / Exact match logic.
        // In a real implementation, we would use a library like 'ipaddr.js'.
        // For now, we'll do exact match and prefix match as a placeholder.
        return this.allowedCIDRs.some(cidr => {
            if (cidr.includes('/')) {
                const [range] = cidr.split('/');
                return ip.startsWith(range); // Naive prefix match for this prototype
            }
            return cidr === ip;
        });
    }

    private handleConnection(socket: INodeSocket) {
        const remoteAddress = socket.remoteAddress;
        if (this.allowedCIDRs.length > 0 && remoteAddress) {
            const isAllowed = this.checkIPAllowed(remoteAddress);
            if (!isAllowed) {
                this.logger?.warn(`[TCPTransport] Connection rejected from unauthorized IP: ${remoteAddress}`);
                socket.destroy();
                return;
            }
        }

        if (!socket.authorized) {
            this.logger?.error(`[TCPTransport] mTLS Unauthorized: ${socket.authorizationError?.message}`);
            socket.destroy();
            return;
        }

        const peer: PeerState = {
            socket,
            nodeID: null,
            isAuthenticated: false,
            isChoked: true,
            bufferPot: new Uint8Array(0),
            bufferList: [],
            bufferPotSize: 0
        };

        const nonce = IsomorphicCrypto.randomID(16);
        const challenge = JSON.stringify({ type: 'challenge', nonce });
        socket.write(TCPFrameCodec.encode(WirePacketType.AUTH, 'handshake', new TextEncoder().encode(challenge)));

        socket.on('data', (chunk: unknown) => {
            if (chunk instanceof Uint8Array) {
                this.processData(peer, chunk);
            }
        });
        socket.on('end', () => {
            if (peer.nodeID) {
                this.peers.delete(peer.nodeID);
                this.emit('peer:disconnect', peer.nodeID);
            }
            this.stopHeartbeat(peer);
        });
        socket.on('error', (err: unknown) => {
            const error = err instanceof Error ? err : new Error(String(err));
            this.emit('error', error);
            socket.destroy();
        });
    }

    private processData(peer: PeerState, chunk: Uint8Array) {
        // Strict edge enforcement
        if (peer.bufferPotSize + chunk.length > TCPFrameCodec.MAX_FRAME_SIZE + 64) {
            this.logger?.error(`[TCPTransport] Buffer overflow threat from ${peer.nodeID || 'unknown'}. Killing connection.`);
            (peer.socket as INodeSocket).destroy();
            return;
        }

        peer.bufferList.push(chunk);
        peer.bufferPotSize += chunk.length;

        try {
            let processing = true;
            while (processing) {
                // Peek at the header to see if we have enough data for a frame
                const totalAvailable = peer.bufferPotSize;
                if (totalAvailable < 21) {
                    processing = false;
                    break;
                }

                // Concatenate only what we need to decode the next frame header
                const tempBuf = this.flattenBufferList(peer.bufferList, 21);
                const payloadLen = new DataView(tempBuf.buffer, tempBuf.byteOffset).getUint32(1 + 16);
                const totalFrameLen = 21 + payloadLen;

                if (totalAvailable < totalFrameLen) {
                    processing = false;
                    break;
                }

                // Now we have a full frame, flatten the exact amount
                const fullFrameBuf = this.flattenBufferList(peer.bufferList, totalFrameLen);

                // Update PeerState
                const { frame, remaining } = TCPFrameCodec.decode(fullFrameBuf);
                if (!frame) {
                    processing = false;
                    break;
                }

                // Reset list with remaining data
                peer.bufferList = remaining.length > 0 ? [remaining] : [];
                peer.bufferPotSize = remaining.length;

                this.dispatchFrame(peer, frame);
            }
        } catch (err: unknown) {
            this.logger?.error(`[TCPTransport] Framing error: ${err instanceof Error ? err.message : String(err)}`);
            (peer.socket as INodeSocket).destroy();
        }
    }

    private flattenBufferList(list: Uint8Array[], length: number): Uint8Array {
        const result = new Uint8Array(length);
        let offset = 0;
        for (let i = 0; i < list.length; i++) {
            const chunk = list[i];
            const toCopy = Math.min(chunk.length, length - offset);
            result.set(chunk.subarray(0, toCopy), offset);
            offset += toCopy;

            // If chunk was partially copied, replace it in the list with the remainder
            if (toCopy < chunk.length) {
                list[i] = chunk.subarray(toCopy);
                // Remove fully copied preceding chunks
                list.splice(0, i);
                return result;
            }
            if (offset === length) {
                // Remove fully copied chunks
                list.splice(0, i + 1);
                return result;
            }
        }
        return result;
    }

    private async dispatchFrame(peer: PeerState, frame: Uint8Array) {
        if (frame.length < 21) { (peer.socket as INodeSocket).destroy(); return; }

        const type = frame[0] as WirePacketType;
        const payload = frame.subarray(21);

        if (!peer.isAuthenticated && type !== WirePacketType.AUTH) {
            (peer.socket as INodeSocket).destroy();
            return;
        }

        switch (type) {
            case WirePacketType.AUTH:
                await this.authHandler.handleAuth(peer, payload);
                if (peer.isAuthenticated) this.startHeartbeat(peer);
                break;
            case WirePacketType.PING:
                // Auto-reply with PONG (re-using AUTH type for now or same type)
                (peer.socket as INodeSocket).write(TCPFrameCodec.encode(WirePacketType.PING, 'pong', new Uint8Array(0)));
                break;
            case WirePacketType.RPC_REQ:
            case WirePacketType.RPC_RES:
                try {
                    const packet = this.serializer.deserialize(payload) as MeshPacket;

                    // Strict Protocol Versioning
                    if (packet.version !== undefined && packet.version !== TCPTransport.PROTOCOL_VERSION) {
                        this.logger?.warn(`[TCPTransport] Dropping packet with incompatible protocol version: ${packet.version}. Expected ${TCPTransport.PROTOCOL_VERSION}`);
                        return;
                    }

                    // Enrich packet with auth metadata for interceptors
                    packet.meta = { ...packet.meta, authenticatedNodeID: peer.nodeID };

                    this.emit('packet', packet);
                } catch (err) {
                    this.logger?.error(`[TCPTransport] Deserialization error: ${err instanceof Error ? err.message : String(err)}`);
                }
                break;
        }
    }

    private startHeartbeat(peer: PeerState) {
        peer.heartbeatTimer = setInterval(() => {
            if (!this.peers.has(peer.nodeID!)) {
                this.stopHeartbeat(peer);
                return;
            }
            try {
                const pong = TCPFrameCodec.encode(WirePacketType.PING, 'ping', new Uint8Array(0));
                const socket = peer.socket as INodeSocket;
                socket.write(pong, (err: unknown) => {
                    if (err) {
                        const error = err instanceof Error ? err : new Error(String(err));
                        this.logger?.warn(`Heartbeat write failed for ${peer.nodeID}: ${error.message}`);
                        (peer.socket as INodeSocket).destroy();
                    }
                });
            } catch (error: unknown) {
                const err = error instanceof Error ? error : new Error(String(error));
                this.logger?.warn(`Heartbeat failed for ${peer.nodeID}: ${err.message}`);
                (peer.socket as INodeSocket).destroy();
            }
        }, 10000); // 10s heartbeat
        peer.heartbeatTimer.unref();
    }

    private stopHeartbeat(peer: PeerState) {
        if (peer.heartbeatTimer) {
            clearInterval(peer.heartbeatTimer);
            peer.heartbeatTimer = undefined;
        }
    }

    async connectToPeer(nodeID: string, url: string): Promise<void> {
        const parsed = new URL(url);
        return new Promise((resolve, reject) => {
            const socket = tls.connect(Number(parsed.port), parsed.hostname, (this.tlsOptions as unknown) as tls.ConnectionOptions, () => {
                const peer: PeerState = {
                    socket: socket as unknown as INodeSocket,
                    nodeID: nodeID,
                    isAuthenticated: false,
                    isChoked: true,
                    bufferPot: new Uint8Array(0),
                    bufferList: [],
                    bufferPotSize: 0
                };


                socket.on('data', (chunk: unknown) => {
                    if (chunk instanceof Uint8Array) {
                        this.processData(peer, chunk);
                    }
                });
                socket.on('end', () => {
                    this.peers.delete(nodeID);
                    this.emit('peer:disconnect', nodeID);
                    this.stopHeartbeat(peer);
                });

                resolve();
            });
            socket.on('error', reject);
        });
    }
}
