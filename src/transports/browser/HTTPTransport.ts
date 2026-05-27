import { BaseTransport } from '../BaseTransport.js';
import type { TransportConnectOptions, MeshPacket } from '../../interfaces/IMeshNetwork.js';

export class HTTPTransport extends BaseTransport {
    public readonly protocol = 'http';
    public readonly version = 1;
    async connect(_opts: TransportConnectOptions): Promise<void> { throw new Error('[HTTPTransport] Not available in browser.'); }
    async disconnect(): Promise<void> { }
    async send(_targetNodeID: string, _packet: MeshPacket): Promise<void> { throw new Error('[HTTPTransport] Not available in browser.'); }
    async publish(_topic: string, _packet: MeshPacket): Promise<void> { }
}
