import type { ILogger  } from './ILogger';
import type { IServiceRegistry  } from './IServiceRegistry';

export type PacketType = 'REQUEST' | 'RESPONSE' | 'RESPONSE_ERROR' | 'EVENT' | 'AUTH' | 'PING'
    | 'STREAM_OPEN' | 'STREAM_DATA' | 'STREAM_ACK' | 'STREAM_CLOSE' | 'STREAM_ERROR';

export interface IMeshPacket<TPayload = unknown> {
    id: string;
    topic: string;
    type: PacketType;
    senderNodeID: string;
    namespace?: string;
    targetNodeID?: string;
    timestamp: number;
    version?: number; // Protocol version
    priority?: number; // QoS: 0=low, 1=normal, 2=high (Raft/Kademlia)
    data?: TPayload;
    error?: { message: string, code?: string | number, data?: unknown };
    meta?: Record<string, unknown>;
    streamID?: string;
}

export type IMeshNetworkSubscriptionHandler<T = unknown> = (data: T, packet: IMeshPacket<T>) => void | Promise<void>;

/**
 * IMeshNetwork — High-level network transport interface.
 */
export interface IMeshNetwork {
    readonly nodeID: string;
    readonly namespace: string;
    readonly logger: ILogger;
    readonly registry: IServiceRegistry;
    
    send<T = unknown>(targetNodeID: string, topic: string, data: T, options?: Partial<IMeshPacket<T>>): Promise<void>;
    publish<T = unknown>(topic: string, data: T): Promise<void>;
    
    onMessage<T = unknown>(topic: string, handler: IMeshNetworkSubscriptionHandler<T>): void;
    
    connectToPeer(nodeID: string, url: string): Promise<void>;

    start(): Promise<void>;
    stop(): Promise<void>;

    server?: unknown;
    setMetrics?(metrics: unknown): void;
}
