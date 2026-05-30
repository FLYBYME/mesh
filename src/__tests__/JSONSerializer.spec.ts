import { JSONSerializer } from '../serializers/JSONSerializer.js';

describe('JSONSerializer', () => {
    let serializer: JSONSerializer;

    beforeEach(() => {
        serializer = new JSONSerializer();
    });

    it('should serialize and deserialize plain objects', () => {
        const data = { hello: 'world', count: 42, flag: true };
        const serialized = serializer.serialize(data);
        expect(serialized).toBeInstanceOf(Uint8Array);

        const deserialized = serializer.deserialize<typeof data>(serialized);
        expect(deserialized).toEqual(data);
    });

    it('should serialize and deserialize nested data', () => {
        const data = {
            nested: {
                arr: [1, 2, { deep: 'value' }],
                empty: null
            }
        };
        const serialized = serializer.serialize(data);
        const deserialized = serializer.deserialize(serialized);
        expect(deserialized).toEqual(data);
    });

    it('should round-trip Buffer objects correctly', () => {
        const buf = Buffer.from('hello world');
        const data = { myBuf: buf };

        const serialized = serializer.serialize(data);
        const deserialized = serializer.deserialize<typeof data>(serialized);

        expect(Buffer.isBuffer(deserialized.myBuf)).toBe(true);
        expect(deserialized.myBuf.toString('utf-8')).toBe('hello world');
    });

    it('should deserialize from a string input', () => {
        const jsonStr = JSON.stringify({ key: 'value' });
        const deserialized = serializer.deserialize<{ key: string }>(jsonStr);
        expect(deserialized).toEqual({ key: 'value' });
    });

    it('should deserialize from an ArrayBuffer input', () => {
        const jsonStr = JSON.stringify({ key: 'value' });
        const encoder = new TextEncoder();
        const buffer = encoder.encode(jsonStr).buffer;

        const deserialized = serializer.deserialize<{ key: string }>(buffer);
        expect(deserialized).toEqual({ key: 'value' });
    });
});
