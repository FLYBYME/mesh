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

    it('should round-trip Date objects correctly', () => {
        const date = new Date('2026-09-07T02:25:59.123Z');
        const data = { createdAt: date, nested: { updatedAt: date } };

        const serialized = serializer.serialize(data);
        const deserialized = serializer.deserialize<typeof data>(serialized);

        expect(deserialized.createdAt).toBeInstanceOf(Date);
        expect(deserialized.createdAt.getTime()).toBe(date.getTime());
        expect(deserialized.nested.updatedAt).toBeInstanceOf(Date);
        expect(deserialized.nested.updatedAt.getTime()).toBe(date.getTime());
    });

    it('should revive ISO 8601 date strings into Date objects', () => {
        const jsonStr = JSON.stringify({ createdAt: '2026-09-07T02:25:59.000Z' });
        const deserialized = serializer.deserialize<{ createdAt: Date }>(jsonStr);

        expect(deserialized.createdAt).toBeInstanceOf(Date);
        expect(deserialized.createdAt.toISOString()).toBe('2026-09-07T02:25:59.000Z');
    });

    it('should not alter non-date strings that do not match ISO format', () => {
        const data = {
            plainString: 'hello world',
            notADate: '2026-99-99T99:99:99Z',
            numericString: '12345678'
        };
        const serialized = serializer.serialize(data);
        const deserialized = serializer.deserialize<typeof data>(serialized);

        expect(deserialized.plainString).toBe('hello world');
        expect(typeof deserialized.plainString).toBe('string');
        expect(deserialized.notADate).toBe('2026-99-99T99:99:99Z');
        expect(typeof deserialized.notADate).toBe('string');
        expect(deserialized.numericString).toBe('12345678');
        expect(typeof deserialized.numericString).toBe('string');
    });
});
