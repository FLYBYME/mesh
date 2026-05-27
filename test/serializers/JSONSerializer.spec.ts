import { JSONSerializer } from '../../src/serializers/JSONSerializer.js';

describe('JSONSerializer', () => {
    let serializer: JSONSerializer;

    beforeEach(() => {
        serializer = new JSONSerializer();
    });

    it('should serialize and deserialize plain objects', () => {
        const data = { foo: 'bar', baz: 123, bool: true };
        const serialized = serializer.serialize(data);
        expect(serialized).toBeInstanceOf(Uint8Array);
        
        const deserialized = serializer.deserialize(serialized);
        expect(deserialized).toEqual(data);
    });

    it('should handle nested objects and arrays', () => {
        const data = {
            a: [1, 2, 3],
            b: { c: { d: 'e' } }
        };
        const serialized = serializer.serialize(data);
        const deserialized = serializer.deserialize(serialized);
        expect(deserialized).toEqual(data);
    });

    it('should handle Buffer objects (Node.js style)', () => {
        const data = {
            buf: Buffer.from('hello world')
        };
        const serialized = serializer.serialize(data);
        const deserialized: any = serializer.deserialize(serialized);
        
        expect(Buffer.isBuffer(deserialized.buf)).toBe(true);
        expect(deserialized.buf.toString()).toBe('hello world');
    });

    it('should handle Buffer-like structure during serialization', () => {
        const data = {
            buf: { type: 'Buffer', data: [1, 2, 3] }
        };
        const serialized = serializer.serialize(data);
        const deserialized: any = serializer.deserialize(serialized);
        expect(Buffer.isBuffer(deserialized.buf)).toBe(true);
        expect(Array.from(deserialized.buf)).toEqual([1, 2, 3]);
    });

    it('should deserialize from string', () => {
        const data = { hello: 'world' };
        const json = JSON.stringify(data);
        const deserialized = serializer.deserialize(json);
        expect(deserialized).toEqual(data);
    });

    it('should deserialize from ArrayBuffer', () => {
        const data = { hello: 'world' };
        const json = JSON.stringify(data);
        const ab = new TextEncoder().encode(json).buffer;
        const deserialized = serializer.deserialize(ab as ArrayBuffer);
        expect(deserialized).toEqual(data);
    });

    it('should throw error on malformed JSON during deserialization', () => {
        const malformed = new TextEncoder().encode('{ invalid json }');
        expect(() => serializer.deserialize(malformed)).toThrow();
    });
});
