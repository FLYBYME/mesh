import type { WirePacketType } from '../../interfaces/IMeshNetwork.js';

export interface IDecodedFrame {
    frame: Uint8Array | null;
    remaining: Uint8Array;
}

/**
 * TCPFrameCodec — handles framing for raw TCP connections.
 * Environment-agnostic implementation using Uint8Array and DataView.
 * 
 * Layout: [Type(1)] [MsgID(16)] [Length(4)] [Payload(N)]
 */
export class TCPFrameCodec {
    public static readonly MAX_FRAME_SIZE = 10 * 1024 * 1024;

    static encode(type: WirePacketType, msgID: string, payload: Uint8Array): Uint8Array {
        if (payload.length > this.MAX_FRAME_SIZE) {
            throw new Error(`Payload size ${payload.length} exceeds maximum frame size ${this.MAX_FRAME_SIZE}`);
        }

        const frame = new Uint8Array(1 + 16 + 4 + payload.length);
        const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);

        // 1. Type
        view.setUint8(0, type);

        // 2. MsgID (16 bytes, padded with spaces)
        const encoder = new TextEncoder();
        const idBytes = encoder.encode(msgID.slice(0, 16));
        frame.set(idBytes, 1);
        // Padding if needed
        for (let i = idBytes.length; i < 16; i++) {
            frame[1 + i] = 32; // Space
        }

        // 3. Length (4 bytes, Big Endian)
        view.setUint32(1 + 16, payload.length, false);

        // 4. Payload
        frame.set(payload, 1 + 16 + 4);

        return frame;
    }

    static decode(buffer: Uint8Array): IDecodedFrame {
        if (buffer.length < 21) return { frame: null, remaining: buffer };

        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        const payloadLen = view.getUint32(1 + 16, false);

        if (payloadLen > this.MAX_FRAME_SIZE) {
            throw new Error(`Incoming payload size ${payloadLen} exceeds maximum frame size ${this.MAX_FRAME_SIZE}`);
        }

        const totalLen = 1 + 16 + 4 + payloadLen;

        if (buffer.length < totalLen) return { frame: null, remaining: buffer };

        return {
            frame: buffer.subarray(0, totalLen),
            remaining: buffer.subarray(totalLen)
        };
    }
}
