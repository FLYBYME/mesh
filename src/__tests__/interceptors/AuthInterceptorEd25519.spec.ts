import { AuthInterceptorEd25519 } from '../../interceptors/AuthInterceptorEd25519.js';
import { MeshPacket } from '../../interfaces/IMeshNetwork.js';
import { IsomorphicCrypto } from '../../utils/Crypto.js';
import crypto from 'crypto';

describe('AuthInterceptorEd25519', () => {
    
    // Generate valid Ed25519 keys for testing
    function generateKeys() {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
        return {
            publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
            privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64')
        };
    }

    const keysNodeA = generateKeys();
    const keysNodeB = generateKeys();

    const mockPublicKeyResolver = async (nodeID: string) => {
        if (nodeID === 'node-a') return keysNodeA.publicKey;
        if (nodeID === 'node-b') return keysNodeB.publicKey;
        return undefined;
    };
    
    it('should throw if no private key is provided', () => {
        expect(() => AuthInterceptorEd25519({ privateKey: '', publicKeyResolver: mockPublicKeyResolver })).toThrow(/private key must be provided/);
    });

    it('should throw if no public key resolver is provided', () => {
        expect(() => AuthInterceptorEd25519({ privateKey: keysNodeA.privateKey, publicKeyResolver: undefined as any })).toThrow(/publicKeyResolver function must be provided/);
    });

    it('should sign outbound packets with Ed25519', async () => {
        const interceptor = AuthInterceptorEd25519({ 
            privateKey: keysNodeA.privateKey, 
            publicKeyResolver: mockPublicKeyResolver 
        });

        const packet: MeshPacket = {
            id: 'pkt_1',
            topic: 'test',
            timestamp: Date.now(),
            senderNodeID: 'node-a',
            data: { msg: 'hello' }
        } as any;

        const signedPacket = await interceptor.onOutbound!(packet) as MeshPacket;
        expect(signedPacket.meta).toBeDefined();
        expect(signedPacket.meta?.signature).toBeDefined();
        
        // verify manually
        const payload = `pkt_1:test:${packet.timestamp}:{"msg":"hello"}`;
        const isValid = await IsomorphicCrypto.verifyEd25519(signedPacket.meta!.signature as string, payload, keysNodeA.publicKey);
        expect(isValid).toBe(true);
    });

    it('should verify valid inbound packets', async () => {
        // Interceptor for Node B
        const interceptor = AuthInterceptorEd25519({ 
            privateKey: keysNodeB.privateKey, 
            publicKeyResolver: mockPublicKeyResolver 
        });

        // Packet signed by Node A
        const packet: MeshPacket = {
            id: 'pkt_2',
            topic: 'test',
            timestamp: Date.now(),
            senderNodeID: 'node-a',
            data: { msg: 'hello' }
        } as any;

        const payload = `pkt_2:test:${packet.timestamp}:{"msg":"hello"}`;
        const signature = await IsomorphicCrypto.signEd25519(payload, keysNodeA.privateKey);
        packet.meta = { signature };

        // Node B should accept the inbound packet
        const verifiedPacket = await interceptor.onInbound!(packet);
        expect(verifiedPacket).toBeDefined();
    });

    it('should reject inbound packets with missing signature', async () => {
        const interceptor = AuthInterceptorEd25519({ 
            privateKey: keysNodeA.privateKey, 
            publicKeyResolver: mockPublicKeyResolver 
        });

        const packet: MeshPacket = {
            id: 'pkt_3',
            topic: 'test',
            timestamp: Date.now(),
            senderNodeID: 'node-b',
            data: { msg: 'hello' }
        } as any;

        await expect(interceptor.onInbound!(packet)).rejects.toThrow(/Missing signature/);
    });

    it('should reject inbound packets with invalid signature', async () => {
        const interceptor = AuthInterceptorEd25519({ 
            privateKey: keysNodeA.privateKey, 
            publicKeyResolver: mockPublicKeyResolver 
        });

        const packet: MeshPacket = {
            id: 'pkt_4',
            topic: 'test',
            timestamp: Date.now(),
            senderNodeID: 'node-b',
            data: { msg: 'hello' },
            meta: { signature: 'invalid-signature' }
        } as any;

        await expect(interceptor.onInbound!(packet)).rejects.toThrow(/Invalid Ed25519 signature/);
    });

    it('should reject packets from unknown nodes (resolver returns undefined)', async () => {
        const interceptor = AuthInterceptorEd25519({ 
            privateKey: keysNodeA.privateKey, 
            publicKeyResolver: mockPublicKeyResolver 
        });

        const packet: MeshPacket = {
            id: 'pkt_5',
            topic: 'test',
            timestamp: Date.now(),
            senderNodeID: 'unknown-node', // Mock resolver will return undefined
            data: { msg: 'hello' },
            meta: { signature: 'fake-signature' }
        } as any;

        await expect(interceptor.onInbound!(packet)).rejects.toThrow(/Unresolved public key/);
    });

    it('should allow unsigned packets if allowUnsigned is true', async () => {
        const interceptor = AuthInterceptorEd25519({ 
            privateKey: keysNodeA.privateKey, 
            publicKeyResolver: mockPublicKeyResolver,
            allowUnsigned: true 
        });

        const packet: MeshPacket = {
            id: 'pkt_6',
            topic: 'test',
            timestamp: Date.now(),
            senderNodeID: 'node-b',
            data: { msg: 'hello' }
        } as any;

        const verifiedPacket = await interceptor.onInbound!(packet);
        expect(verifiedPacket).toBe(packet);
    });

    it('should reject replayed packets (too old)', async () => {
        const interceptor = AuthInterceptorEd25519({ 
            privateKey: keysNodeA.privateKey, 
            publicKeyResolver: mockPublicKeyResolver,
            maxAgeMs: 1000 // 1 second
        }); 

        const packet: MeshPacket = {
            id: 'pkt_7',
            topic: 'test',
            timestamp: Date.now() - 2000, // 2 seconds old
            senderNodeID: 'node-a',
            data: { msg: 'hello' }
        } as any;

        const payload = `pkt_7:test:${packet.timestamp}:{"msg":"hello"}`;
        packet.meta = { signature: await IsomorphicCrypto.signEd25519(payload, keysNodeA.privateKey) };

        await expect(interceptor.onInbound!(packet)).rejects.toThrow(/Timestamp out of bounds/);
    });
});
