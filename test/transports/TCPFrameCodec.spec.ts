import { TCPFrameCodec } from '../../src/transports/helpers/TCPFrameCodec.js';
import { WirePacketType } from '../../src/interfaces/IMeshNetwork.js';

describe('TCPFrameCodec', () => {
    const type = WirePacketType.RPC_REQ;
    const msgID = '1234567890123456';
    const payload = new TextEncoder().encode('hello world');

    describe('encode', () => {
        it('should encode a frame correctly', () => {
            const frame = TCPFrameCodec.encode(type, msgID, payload);
            expect(frame.length).toBe(1 + 16 + 4 + payload.length);
            
            const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
            expect(view.getUint8(0)).toBe(type);
            
            const decodedID = new TextDecoder().decode(frame.subarray(1, 17));
            expect(decodedID).toBe(msgID);
            
            expect(view.getUint32(17, false)).toBe(payload.length);
            expect(frame.subarray(21)).toEqual(payload);
        });

        it('should pad short msgID with spaces', () => {
            const shortID = 'short';
            const frame = TCPFrameCodec.encode(type, shortID, payload);
            const decodedID = new TextDecoder().decode(frame.subarray(1, 17));
            expect(decodedID).toBe(shortID.padEnd(16, ' '));
        });

        it('should truncate long msgID', () => {
            const longID = '12345678901234567890';
            const frame = TCPFrameCodec.encode(type, longID, payload);
            const decodedID = new TextDecoder().decode(frame.subarray(1, 17));
            expect(decodedID).toBe(longID.slice(0, 16));
        });

        it('should throw if payload exceeds MAX_FRAME_SIZE', () => {
            const hugePayload = new Uint8Array(TCPFrameCodec.MAX_FRAME_SIZE + 1);
            expect(() => TCPFrameCodec.encode(type, msgID, hugePayload)).toThrow(/exceeds maximum frame size/);
        });
    });

    describe('decode', () => {
        it('should decode a valid frame', () => {
            const frame = TCPFrameCodec.encode(type, msgID, payload);
            const result = TCPFrameCodec.decode(frame);
            expect(result.frame).toEqual(frame);
            expect(result.remaining.length).toBe(0);
        });

        it('should return null frame if buffer is too short (< 21)', () => {
            const result = TCPFrameCodec.decode(new Uint8Array(10));
            expect(result.frame).toBeNull();
            expect(result.remaining.length).toBe(10);
        });

        it('should return null frame if buffer is shorter than expected length', () => {
            const frame = TCPFrameCodec.encode(type, msgID, payload);
            const result = TCPFrameCodec.decode(frame.subarray(0, 25));
            expect(result.frame).toBeNull();
            expect(result.remaining.length).toBe(25);
        });

        it('should return remaining bytes after a complete frame', () => {
            const frame = TCPFrameCodec.encode(type, msgID, payload);
            const extra = new Uint8Array([1, 2, 3]);
            const buffer = new Uint8Array(frame.length + extra.length);
            buffer.set(frame);
            buffer.set(extra, frame.length);

            const result = TCPFrameCodec.decode(buffer);
            expect(result.frame).toEqual(frame);
            expect(result.remaining).toEqual(extra);
        });

        it('should throw if length field exceeds MAX_FRAME_SIZE', () => {
            const frame = new Uint8Array(30);
            const view = new DataView(frame.buffer);
            view.setUint32(17, TCPFrameCodec.MAX_FRAME_SIZE + 1, false);
            expect(() => TCPFrameCodec.decode(frame)).toThrow(/exceeds maximum frame size/);
        });
    });
});
