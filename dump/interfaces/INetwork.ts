import type { ILogger  } from './ILogger';

export type PacketType = 'REQUEST' | 'RESPONSE' | 'RESPONSE_ERROR' | 'EVENT' | 'AUTH' | 'PING';

export interface IMeshPacket<TPayload = unknown> {
    id: string;
    topic: string;
    type: PacketType;
    senderNodeID: string;
    targetNodeID?: string;
    timestamp: number;
    version?: number; // Protocol version
    priority?: number; // QoS
    data: TPayload;
    meta?: Record<string, unknown>;
}

export type INetworkSubscriptionHandler<T = unknown> = (data: T, packet: IMeshPacket<T>) => void | Promise<void>;

/**
 * INetwork — Interface for the inter-node communication layer.
 */
export interface INetwork {
    readonly nodeID: string;
    readonly logger: ILogger;
    
    send<T = unknown>(targetNodeID: string, topic: string, data: T): Promise<void>;
    publish<T = unknown>(topic: string, data: T): Promise<void>;
    
    onMessage<T = unknown>(topic: string, handler: INetworkSubscriptionHandler<T>): void;
    
    start(): Promise<void>;
    stop(): Promise<void>;
}
