import { IInterceptor } from '../interfaces/IInterceptor.js';
import { MeshPacket } from '../interfaces/IMeshNetwork.js';
import { IsomorphicCrypto } from '../utils/Crypto.js';

export interface AuthInterceptorEd25519Options {
    privateKey: string;
    publicKeyResolver: (nodeID: string) => Promise<string | undefined>;
    maxAgeMs?: number; // Replay protection window (default 30s)
    allowUnsigned?: boolean; // Whether to accept packets without signatures (default false)
}

export function AuthInterceptorEd25519(options: AuthInterceptorEd25519Options): IInterceptor<MeshPacket, MeshPacket> {
    const { privateKey, publicKeyResolver, maxAgeMs = 30000, allowUnsigned = false } = options;

    if (!privateKey) {
        throw new Error('[AuthInterceptorEd25519] A private key must be provided');
    }

    if (!publicKeyResolver || typeof publicKeyResolver !== 'function') {
        throw new Error('[AuthInterceptorEd25519] A publicKeyResolver function must be provided');
    }

    const serializePayload = (packet: MeshPacket): string => {
        // Create a deterministic string representation of the core packet data
        const dataStr = typeof packet.data === 'string' ? packet.data : JSON.stringify(packet.data ?? null);
        return `${packet.id}:${packet.topic}:${packet.timestamp}:${dataStr}`;
    };

    return {
        name: 'auth-ed25519-interceptor',
        onOutbound: async (packet: MeshPacket): Promise<MeshPacket> => {
            const payload = serializePayload(packet);
            const signature = await IsomorphicCrypto.signEd25519(payload, privateKey);
            
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
                throw new Error(`[AuthInterceptorEd25519] Packet ${packet.id} rejected: Timestamp out of bounds (age: ${age}ms)`);
            }

            const signature = packet.meta?.signature;
            
            if (!signature) {
                if (allowUnsigned) {
                    return packet;
                }
                throw new Error(`[AuthInterceptorEd25519] Packet ${packet.id} rejected: Missing signature`);
            }

            const senderPublicKey = await publicKeyResolver(packet.senderNodeID);
            
            if (!senderPublicKey) {
                throw new Error(`[AuthInterceptorEd25519] Packet ${packet.id} rejected: Unresolved public key for node ${packet.senderNodeID}`);
            }

            const payload = serializePayload(packet);
            const isValid = await IsomorphicCrypto.verifyEd25519(signature as string, payload, senderPublicKey);

            if (!isValid) {
                throw new Error(`[AuthInterceptorEd25519] Packet ${packet.id} rejected: Invalid Ed25519 signature`);
            }

            return packet;
        }
    };
}
