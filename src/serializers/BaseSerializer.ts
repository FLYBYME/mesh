/**
 * BaseSerializer — abstract contract for packet serialization.
 */
export abstract class BaseSerializer {
    abstract readonly type: string;

    /** Serialize a payload object into a Uint8Array for transmission */
    abstract serialize(data: unknown): Uint8Array;

    /** Deserialize a Uint8Array back into a payload object */
    abstract deserialize<T>(buf: Uint8Array | ArrayBuffer | string): T;
}
