import { BaseSerializer } from './BaseSerializer';

/**
 * JSONSerializer — standard JSON-based serialization.
 */
export class JSONSerializer extends BaseSerializer {
    readonly type = 'json';
    private encoder = new TextEncoder();
    private decoder = new TextDecoder();

    serialize(data: unknown): Uint8Array {
        return this.encoder.encode(JSON.stringify(data, (key, value) => {
            // Check if value is a Buffer or has Buffer-like structure
            if (value && typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data)) {
                return value;
            }
            if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
                return { type: 'Buffer', data: Array.from(value) };
            }
            return value;
        }));
    }

    deserialize<T>(raw: Uint8Array | ArrayBuffer | string): T {
        let str: string;

        if (typeof raw === 'string') {
            str = raw;
        } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw)) {
            str = (raw as Buffer).toString('utf-8');
        } else {
            str = this.decoder.decode(raw as Uint8Array | ArrayBuffer);
        }

        return JSON.parse(str, (key, value) => {
            if (value && typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data)) {
                return Buffer.from(value.data);
            }
            return value;
        }) as T;
    }

    private isBuffer(raw: unknown): raw is { toString(enc: string): string } {
        return typeof Buffer !== 'undefined' && Buffer.isBuffer(raw);
    }
}
