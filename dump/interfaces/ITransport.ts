import type { IMeshPacket } from '../contracts/packet.schema';

/**
 * ITransport — Unified contract for browser and worker communication.
 */
export interface ITransport {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    send(packet: IMeshPacket): Promise<void>;
    onMessage(handler: (packet: IMeshPacket) => void): void;
    onError(handler: (error: Error) => void): void;
}
