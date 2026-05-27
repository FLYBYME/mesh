import type { IMeshPacket  } from '../INetwork';
export interface INetworkAdapter {
    send(targetNodeID: string, topic: string, data: unknown): Promise<void>;
    broadcast(topic: string, data: unknown): Promise<void>;
    on(topic: string, handler: (data: unknown, packet: IMeshPacket) => void): void;
    getNodeID(): string;
}
