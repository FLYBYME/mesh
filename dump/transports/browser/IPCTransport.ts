import { BaseTransport } from '../BaseTransport';
import type { TransportConnectOptions } from '../../types/mesh.types';
import type { MeshPacket } from '../../types/packet.types';

export class IPCTransport extends BaseTransport {
    public readonly protocol = 'ipc';
    public readonly version = 1;
    async connect(_opts: TransportConnectOptions): Promise<void> { throw new Error('[IPCTransport] Not available in browser.'); }
    async disconnect(): Promise<void> {}
    async send(_targetNodeID: string, _packet: MeshPacket): Promise<void> { throw new Error('[IPCTransport] Not available in browser.'); }
    async publish(_topic: string, _packet: MeshPacket): Promise<void> {}
}
