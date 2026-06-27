import { IInterceptor } from '../interfaces/IInterceptor.js';
import { MeshPacket } from '../interfaces/IMeshNetwork.js';
import { IsomorphicCrypto } from '../utils/Crypto.js';

export interface AuthInterceptorHMACOptions {
    secret: string;
    maxAgeMs?: number; // Replay protection window (default 30s)
    allowUnsigned?: boolean; // Whether to accept packets without signatures (default false)
}

export function AuthInterceptorHMAC(options: AuthInterceptorHMACOptions): IInterceptor<MeshPacket, MeshPacket> {
    const { secret, maxAgeMs = 30000, allowUnsigned = false } = options;

    if (!secret) {
        throw new Error('[AuthInterceptor] A shared secret must be provided');
    }

    const serializePayload = (packet: MeshPacket): string => {
        // Create a deterministic string representation of the core packet data
        const dataStr = typeof packet.data === 'string' ? packet.data : JSON.stringify(packet.data ?? null);
        return `${packet.id}:${packet.topic}:${packet.timestamp}:${dataStr}`;
    };

    return {
        name: 'auth-interceptor',
        onOutbound: async (packet: MeshPacket): Promise<MeshPacket> => {
            const payload = serializePayload(packet);
            const signature = await IsomorphicCrypto.signHMAC(payload, secret);

            if (!packet.meta) {
                packet.meta = {};
            }
            packet.meta.signature = signature;

            return packet;
        },
        onInbound: async (packet: MeshPacket): Promise<MeshPacket> => {
            // Replay Protection
            const age = Date.now() - packet.timestamp;
            if (age > maxAgeMs || age < -5000) { // allow 5s clock skew into the future
                throw new Error(`[AuthInterceptor] Packet ${packet.id} rejected: Timestamp out of bounds (age: ${age}ms)`);
            }

            const signature = packet.meta?.signature;

            if (!signature) {
                if (allowUnsigned) {
                    return packet;
                }
                throw new Error(`[AuthInterceptor] Packet ${packet.id} rejected: Missing signature`);
            }

            const payload = serializePayload(packet);
            const isValid = await IsomorphicCrypto.verifyHMAC(signature as string, payload, secret);

            if (!isValid) {
                throw new Error(`[AuthInterceptor] Packet ${packet.id} rejected: Invalid HMAC signature`);
            }

            return packet;
        }
    };
}
