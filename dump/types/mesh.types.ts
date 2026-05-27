import type {
    IServiceRegistry, IMeshNode,
    IMeshNetwork, ILogger as ICoreLogger,
    NodeResources, NodeCapabilities
} from '../interfaces';

export type { IServiceRegistry, IMeshNode, IMeshNetwork, NodeResources, NodeCapabilities };

export interface ILogger extends ICoreLogger {
    trace?(msg: string, data?: Record<string, unknown>): void;
}

export interface ActionInfo {
    name?: string;
    visibility?: 'public' | 'user' | 'internal' | 'published' | 'protected' | 'private';
    params?: Record<string, unknown>;
    rest?: Record<string, unknown>;
    roles?: string[];
    matchAny?: boolean;
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
    actions?: Record<string, ActionInfo>;
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
    publicKey?: string; // Ed25519 Public Key
}

export interface IPacket<T = Record<string, unknown>> {
    id: string;
    topic: string;
    type: 'event' | 'request' | 'response' | 'error';
    payload: T;
    senderNodeID: string;
    timestamp: number;
    meta?: Record<string, unknown>;
}

export enum WirePacketType {
    AUTH = 0x01,
    RPC_REQ = 0x02,
    RPC_RES = 0x03,
    PIECE_DATA = 0x04,
    PING = 0x05,
}

export interface ITransportSocket {
    send(data: Uint8Array | string): void;
    close(): void;
    readonly readyState: number;
}

export interface IWS extends ITransportSocket {
    on(event: string, cb: (...args: unknown[]) => void): void;
    terminate?(): void;
    ping?(): void;
    bufferedAmount: number;
}

export interface IWSServer {
    on(event: 'connection', cb: (ws: IWS, req: unknown) => void): void;
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

export interface IMeshOrchestrator {
    broadcastPresence(targetNodeID?: string): Promise<void>;
    handlePEX(data: { peers: Partial<NodeInfo>[] }): Promise<void>;
    handlePresence(data: { node: NodeInfo }): Promise<void>;
    handlePeerConnect(nodeID: string): Promise<void>;
    handlePeerDisconnect(nodeID: string): Promise<void>;
}

export interface IMeshNetworkNode extends IMeshNode, IMeshNetwork {
    orchestrator: IMeshOrchestrator;
}

export type TransportType = 'ws' | 'http' | 'tcp' | 'tls' | 'ipc' | 'nats' | 'mock' | 'webrtc';
export type SerializerType = 'json' | 'binary' | 'protobuf';

export interface TransportConnectOptions {
    url: string;
    nodeID: string;
    namespace: string;
    authToken?: string;
    sharedServer?: unknown; // http.Server
    sharedApp?: unknown;    // express.Application
    host?: string;
    port?: number;
    logger?: ILogger;
    registry?: IServiceRegistry;
    privateKey?: string;
    tls?: unknown; // tls.TlsOptions
}
