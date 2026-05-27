import { BaseTransport } from '../BaseTransport';
import type { TransportConnectOptions } from '../../types/mesh.types';
import type { MeshPacket } from '../../types/packet.types';

export class TCPTransport extends BaseTransport {
    public readonly protocol = 'tcp';
    public readonly version = 1;
    async connect(_opts: TransportConnectOptions): Promise<void> { throw new Error('[TCPTransport] Not available in browser.'); }
    async disconnect(): Promise<void> {}
    async send(_targetNodeID: string, _packet: MeshPacket): Promise<void> { throw new Error('[TCPTransport] Not available in browser.'); }
    async publish(_topic: string, _packet: MeshPacket): Promise<void> {}
}
