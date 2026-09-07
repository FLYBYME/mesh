import { BaseSerializer } from './BaseSerializer.js';

/**
 * A full ISO 8601 instant, and nothing looser.
 *
 * **Why a date needs reviving at all.** `Date.prototype.toJSON` produces a bare string, so a `Date`
 * that crosses the wire arrives as text and every `z.date()` on the far side rejects it —
 * `ZodError: Invalid date` on a response that was perfectly correct when it was sent. Every
 * collection has `createdAt`/`updatedAt`, so this broke **every remote read of every collection**
 * while the whole suite stayed green, because a local call never serializes.
 *
 * **Why revival rather than a tagged envelope.** Tagging (`{__type:'Date',…}`) at serialize time is
 * more precise and it changes the wire format, which means a node running the new code and a node
 * running the old one disagree in *both* directions during a rolling upgrade. Reviving keeps the
 * bytes exactly as they were — a new node reads an old node's output correctly, and an old node
 * reads a new node's output correctly — so a fleet can be upgraded one machine at a time. With
 * seven machines and no maintenance window, that matters more than the precision does.
 *
 * **What it costs, stated plainly.** A `z.string()` field whose value happens to be a full ISO
 * instant becomes a `Date` and then fails its own schema. The pattern is anchored and demands the
 * `T`, the time and a zone, so `"2026-09-07"` and `"09:30"` are untouched — but the risk is real
 * rather than theoretical, and the fix if it bites is to tag *that field*, not to widen this.
 */
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

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
            if (typeof value === 'string' && ISO_DATE_REGEX.test(value)) {
                const d = new Date(value);
                if (!isNaN(d.getTime())) {
                    return d;
                }
            }
            return value;
        }) as T;
    }

    private isBuffer(raw: unknown): raw is { toString(enc: string): string } {
        return typeof Buffer !== 'undefined' && Buffer.isBuffer(raw);
    }
}
