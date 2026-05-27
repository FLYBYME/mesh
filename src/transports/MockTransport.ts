import { BaseTransport } from './BaseTransport.js';
import { BaseSerializer } from '../serializers/BaseSerializer.js';
import { TransportConnectOptions, MeshPacket } from '../interfaces/IMeshNetwork.js';

/**
 * MockTransport — A simple in-memory transport for testing.
 */
export class MockTransport extends BaseTransport {
    readonly protocol = 'mock' as any;
    readonly version = 1;

    constructor(serializer: BaseSerializer) {
        super(serializer);
    }

    async connect(_opts: TransportConnectOptions): Promise<void> {
        this.connected = true;
    }

    async disconnect(): Promise<void> {
        this.connected = false;
    }

    async send(_nodeID: string, _packet: MeshPacket): Promise<void> {}
    async publish(_topic: string, _packet: MeshPacket): Promise<void> {}
}
