import type { ILogger } from './ILogger.js';
import type { IServiceRegistry } from './IServiceRegistry.js';

// --- Packet Types ---

export type PacketType = 'REQUEST' | 'RESPONSE' | 'RESPONSE_ERROR' | 'EVENT' | 'AUTH' | 'PING'
    | 'STREAM_OPEN' | 'STREAM_DATA' | 'STREAM_ACK' | 'STREAM_CLOSE' | 'STREAM_ERROR';

export interface BasePacket {
    id: string;
    topic: string;
    type: PacketType;
    senderNodeID: string;
    namespace?: string;
    targetNodeID?: string;
    timestamp: number;
    version?: number;
    priority?: number;
    meta?: Record<string, unknown>;
}

export interface RPCRequest extends BasePacket {
    type: 'REQUEST';
    data: unknown;
}

export interface RPCResponse extends BasePacket {
    type: 'RESPONSE';
    data: unknown;
}

export interface RPCErrorResponse extends BasePacket {
    type: 'RESPONSE_ERROR';
    error: {
        message: string;
        code?: number | string;
        data?: unknown;
    };
    data?: never;
}

export interface EventPacket extends BasePacket {
    type: 'EVENT';
    data: unknown;
}

export interface StreamPacket extends BasePacket {
    type: 'STREAM_OPEN' | 'STREAM_DATA' | 'STREAM_ACK' | 'STREAM_CLOSE' | 'STREAM_ERROR';
    streamID: string;
    data?: unknown;
    error?: {
        message: string;
        code?: number | string;
        data?: unknown;
    };
}

export interface AuthPacket extends BasePacket {
    type: 'AUTH';
    data: unknown;
}

export interface PingPacket extends BasePacket {
    type: 'PING';
    data?: unknown;
}

export type MeshPacket = RPCRequest | RPCResponse | RPCErrorResponse | EventPacket | StreamPacket | AuthPacket | PingPacket;

export interface IMeshPacket<T = unknown> extends BasePacket {
    data?: T;
    error?: { message: string, code?: string | number, data?: unknown };
    streamID?: string;
}

// --- Network Interfaces ---

export type IMeshNetworkSubscriptionHandler<T = unknown> = (data: T, packet: IMeshPacket<T>) => void | Promise<void>;

export interface IMeshNetwork {
    readonly nodeID: string;
    readonly namespace: string;
    readonly logger: ILogger;
    readonly registry: IServiceRegistry;

    send<T = unknown>(targetNodeID: string, topic: string, data: T, options?: Partial<IMeshPacket<T>>): Promise<void>;
    publish<T = unknown>(topic: string, data: T): Promise<void>;

    onMessage<T = unknown>(topic: string, handler: IMeshNetworkSubscriptionHandler<T>): void;

    connectToPeer(nodeID: string, url: string): Promise<void>;

    /** Whether a direct connection to this peer is currently open. */
    isPeerConnected?(nodeID: string): boolean;

    /** Every direct link this node holds right now. */
    peerLinks?(): readonly PeerLink[];

    /** Calls `handler` each time a direct link comes up or goes down. Returns the unsubscribe. */
    onLinkChange?(handler: (change: LinkChange) => void): () => void;

    start(): Promise<void>;
    stop(): Promise<void>;

    server?: unknown;
}

/** One direct transport link from this node to a peer. */
export interface PeerLink {
    readonly nodeID: string;
    /** Which end opened it: this node (`'self'`) or the peer (`'remote'`). */
    readonly dialedBy: 'self' | 'remote';
    /** When the link was opened (epoch ms). */
    readonly openedAt: number;
    /** When a frame last arrived on it (epoch ms). */
    readonly lastMessageAt: number;
}

/** A direct link to `peer` coming up or going down. */
export interface LinkChange {
    readonly peer: string;
    readonly state: 'up' | 'down';
}

// --- Discovery & Node Types ---

export interface NodeResources {
    cpu?: number;
    memory?: {
        total: number;
        free: number;
        used: number;
    };
    storage?: Record<string, unknown>;
    [key: string]: unknown;
}

export interface NodeCapabilities {
    transports?: string[];
    features?: string[];
    [key: string]: unknown;
}

export interface ToolInfo {
    name?: string;
    description?: string;
    visibility?: 'public' | 'user' | 'internal' | 'published' | 'protected' | 'private';
    params?: Record<string, unknown>;
    returns?: Record<string, unknown>;
    rest?: Record<string, unknown>;
    roles?: string[];
    matchAny?: boolean;
    metadata?: Record<string, unknown>;
    timeout?: number;
}

export interface EventInfo {
    name?: string;
    group?: string;
}

export interface ServiceInfo {
    name: string;
    fullName?: string;
    version?: string | number;
    settingsSchema?: Record<string, unknown>;
    dependencies?: string[];
    tools?: Record<string, ToolInfo>;
    events?: Record<string, EventInfo>;
    metadata?: Record<string, unknown>;
    rest?: Record<string, unknown>;
}

export interface NodeInfo {
    nodeID: string;
    hostname?: string;
    type: string;
    nodeType?: string;
    namespace: string;
    addresses: string[];
    trustLevel?: 'internal' | 'user' | 'public';
    available?: boolean;
    timestamp?: number;
    capabilities?: NodeCapabilities;
    resources?: NodeResources;
    nodeSeq?: number;
    services: ServiceInfo[];
    pid?: number;
    parentID?: string;
    hidden?: boolean;
    metadata?: Record<string, unknown>;
    cpu?: number;
    activeRequests?: number;
    healthScore?: number;
    lastHeartbeatTime?: number;
    publicKey?: string;
    bootedAt?: number;
}

export interface IServiceNode {
    nodeID: string;
    services: string[];
    metadata?: Record<string, unknown>;
}

export interface IMeshBaseNode {
    nodeID: string;
    namespace: string;
}

export interface IMeshOrchestrator {
    broadcastPresence(targetNodeID?: string): Promise<void>;
    handlePEX(data: { peers: Partial<NodeInfo>[] }): Promise<void>;
    handlePresence(data: { node: NodeInfo }): Promise<void>;
    handlePeerConnect(nodeID: string): Promise<void>;
    handlePeerDisconnect(nodeID: string): Promise<void>;
}

export interface IMeshNetworkNode extends IMeshBaseNode {
    logger: ILogger;
    registry: IServiceRegistry;
    orchestrator?: IMeshOrchestrator;
    send<T = unknown>(targetNodeID: string, topic: string, data: T, options?: Partial<IMeshPacket<T>>): Promise<void>;
    publish<T = unknown>(topic: string, data: T): Promise<void>;
    connectToPeer(nodeID: string, url: string): Promise<void>;
    /** Whether a direct connection to this peer is currently open. */
    isPeerConnected?(nodeID: string): boolean;
    /** Whether `url` needs dialing; `undefined` when the transport cannot tell. See BaseTransport.needsDial. */
    needsDial?(url: string): boolean | undefined;
}

// --- Transport Types ---

export type TransportType = 'ws' | 'http' | 'tcp' | 'tls' | 'ipc' | 'nats' | 'mock' | 'webrtc';
export type SerializerType = 'json' | 'binary' | 'protobuf';

export interface TransportConnectOptions {
    url: string;
    nodeID: string;
    namespace: string;
    authToken?: string;
    authKey?: string;
    sharedServer?: unknown;
    sharedApp?: unknown;
    host?: string;
    port?: number;
    logger?: ILogger;
    registry?: IServiceRegistry;
    privateKey?: string;
    tls?: unknown;
}

export interface ITransportSocket {
    send(data: Uint8Array | string): void;
    /**
     * `code`/`reason` are the WebSocket close frame's, forwarded to the peer so a refusal can say
     * why -- see WSTransport's DUPLICATE_NODE_ID_CLOSE. Optional: an implementation that closes
     * without them still satisfies this.
     */
    close(code?: number, reason?: string): void;
    readonly readyState: number;
}

export interface IWS extends ITransportSocket {
    on(event: string, cb: (...args: unknown[]) => void): void;
    once(event: string, cb: (...args: unknown[]) => void): void;
    terminate?(): void;
    ping?(): void;
    bufferedAmount: number;
}

export interface IWSServer {
    on(event: 'connection', cb: (ws: IWS, req: unknown) => void): void;
    /** The response headers of an upgrade, before they are sent -- mutable, to add our own. */
    on(event: 'headers', cb: (headers: string[], req: unknown) => void): void;
    close(cb?: (err?: Error) => void): void;
}

export interface INodeSocket extends ITransportSocket {
    on(event: string, cb: (data: unknown) => void): void;
    once(event: string, cb: (data: unknown) => void): void;
    write(data: Uint8Array | string, cb?: (err?: Error) => void): boolean;
    destroy(): void;
    address(): unknown;
    remoteAddress?: string;
    send(data: Uint8Array | string): void;
    close(): void;
    authorized?: boolean;
    authorizationError?: Error;
}

export interface PeerState {
    socket: ITransportSocket;
    nodeID: string | null;
    isAuthenticated: boolean;
    isChoked: boolean;
    bufferPot: Uint8Array;
    bufferList: Uint8Array[];
    bufferPotSize: number;
    heartbeatTimer?: NodeJS.Timeout;
}

export enum WirePacketType {
    AUTH = 0x01,
    RPC_REQ = 0x02,
    RPC_RES = 0x03,
    PIECE_DATA = 0x04,
    PING = 0x05,
}
