import { BaseSerializer } from './BaseSerializer.js';

/** The same pattern, and the same reasoning, as `JSONSerializer` — see its comment. Duplicated
 *  rather than shared because a serializer that imports another serializer's internals is the
 *  coupling this package exists to avoid; if a third one appears, that is when it moves. */
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export class BinarySerializer extends BaseSerializer {
    readonly type = 'binary';
    private encoder = new TextEncoder();
    private decoder = new TextDecoder();

    serialize(data: unknown): Uint8Array {
        return this.encoder.encode(JSON.stringify(data));
    }

    deserialize<T>(buf: Uint8Array | ArrayBuffer | string): T {
        const str = typeof buf === 'string' ? buf : this.decoder.decode(buf);
        return JSON.parse(str, (key, value) => {
            if (typeof value === 'string' && ISO_DATE_REGEX.test(value)) {
                const d = new Date(value);
                if (!isNaN(d.getTime())) {
                    return d;
                }
            }
            return value;
        }) as T;
    }
}
