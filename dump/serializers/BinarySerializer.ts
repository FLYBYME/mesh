import { BaseSerializer } from './BaseSerializer';

export class BinarySerializer extends BaseSerializer {
    readonly type = 'binary';
    private encoder = new TextEncoder();
    private decoder = new TextDecoder();

    serialize(data: unknown): Uint8Array {
        return this.encoder.encode(JSON.stringify(data));
    }

    deserialize<T>(buf: Uint8Array | ArrayBuffer | string): T {
        const str = typeof buf === 'string' ? buf : this.decoder.decode(buf);
        return JSON.parse(str) as T;
    }
}
