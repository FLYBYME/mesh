import { BaseSerializer } from '../serializers/BaseSerializer';
import { JSONSerializer } from '../serializers/JSONSerializer';
import { BinarySerializer } from '../serializers/BinarySerializer';
import { ProtoBufSerializer } from '../serializers/ProtoBufSerializer';
import { BaseTransport } from '../transports/BaseTransport';
import type { TransportType, SerializerType } from '../types/mesh.types';

/**
 * TransportFactory — Creates transport and serializer instances.
 * Refactored: No longer statically imports specific transports to prevent dependency leakage.
 * Transports must be registered or injected.
 */
export class TransportFactory {
    static createSerializer(type: SerializerType): BaseSerializer {
        switch (type) {
            case 'binary': return new BinarySerializer();
            case 'protobuf': return new ProtoBufSerializer();
            case 'json':
            default: return new JSONSerializer();
        }
    }

    /**
     * @deprecated Use dependency injection via TransportManager instead.
     */
    static createTransport(type: TransportType, _serializer: BaseSerializer, _port: number): BaseTransport {
        throw new Error(`[TransportFactory] Static creation of '${type}' is disabled. Inject transport instances instead.`);
    }
}
