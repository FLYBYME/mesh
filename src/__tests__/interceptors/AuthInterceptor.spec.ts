// The factory is `AuthInterceptorHMAC`; this suite still imported a name (`AuthInterceptor`) that
// the module has not exported for some time, so every case here failed on "is not a function"
// rather than on anything it was written to check. The failures were invisible behind 78 unrelated
// MONGODB_URI errors, which is how a whole suite stayed dead without anyone noticing.
import { AuthInterceptorHMAC } from '../../interceptors/AuthInterceptor.js';
import { MeshPacket } from '../../interfaces/IMeshNetwork.js';
import { IsomorphicCrypto } from '../../utils/Crypto.js';

describe('AuthInterceptor', () => {
    const SECRET = 'test-secret';
    
    it('should throw if no secret is provided', () => {
        expect(() => AuthInterceptorHMAC({ secret: '' })).toThrow(/shared secret must be provided/);
    });

    it('should sign outbound packets', async () => {
        const interceptor = AuthInterceptorHMAC({ secret: SECRET });
        const packet: MeshPacket = {
            id: 'pkt_1',
            topic: 'test',
            timestamp: Date.now(),
            data: { msg: 'hello' }
        } as any;

        const signedPacket = await interceptor.onOutbound!(packet) as MeshPacket;
        expect(signedPacket.meta).toBeDefined();
        expect(signedPacket.meta?.signature).toBeDefined();
        
        // verify manually
        const payload = `pkt_1:test:${packet.timestamp}:{"msg":"hello"}`;
        const isValid = await IsomorphicCrypto.verifyHMAC(signedPacket.meta!.signature as string, payload, SECRET);
        expect(isValid).toBe(true);
    });

    it('should verify valid inbound packets', async () => {
        const interceptor = AuthInterceptorHMAC({ secret: SECRET });
        const packet: MeshPacket = {
            id: 'pkt_2',
            topic: 'test',
            timestamp: Date.now(),
            data: { msg: 'hello' }
        } as any;

        const signedPacket = await interceptor.onOutbound!(packet) as MeshPacket;
        
        // Inbound should not throw
        const verifiedPacket = await interceptor.onInbound!(signedPacket);
        expect(verifiedPacket).toBeDefined();
    });

    it('should reject inbound packets with missing signature', async () => {
        const interceptor = AuthInterceptorHMAC({ secret: SECRET });
        const packet: MeshPacket = {
            id: 'pkt_3',
            topic: 'test',
            timestamp: Date.now(),
            data: { msg: 'hello' }
        } as any;

        await expect(interceptor.onInbound!(packet)).rejects.toThrow(/Missing signature/);
    });

    it('should reject inbound packets with invalid signature', async () => {
        const interceptor = AuthInterceptorHMAC({ secret: SECRET });
        const packet: MeshPacket = {
            id: 'pkt_4',
            topic: 'test',
            timestamp: Date.now(),
            data: { msg: 'hello' },
            meta: { signature: 'invalid-signature' }
        } as any;

        await expect(interceptor.onInbound!(packet)).rejects.toThrow(/Invalid HMAC signature/);
    });

    it('should allow unsigned packets if allowUnsigned is true', async () => {
        const interceptor = AuthInterceptorHMAC({ secret: SECRET, allowUnsigned: true });
        const packet: MeshPacket = {
            id: 'pkt_5',
            topic: 'test',
            timestamp: Date.now(),
            data: { msg: 'hello' }
        } as any;

        const verifiedPacket = await interceptor.onInbound!(packet);
        expect(verifiedPacket).toBe(packet);
    });

    it('should reject replayed packets (too old)', async () => {
        const interceptor = AuthInterceptorHMAC({ secret: SECRET, maxAgeMs: 1000 }); // 1 second
        const packet: MeshPacket = {
            id: 'pkt_6',
            topic: 'test',
            timestamp: Date.now() - 2000, // 2 seconds old
            data: { msg: 'hello' }
        } as any;

        const signedPacket = await interceptor.onOutbound!(packet) as MeshPacket;

        await expect(interceptor.onInbound!(signedPacket)).rejects.toThrow(/Timestamp out of bounds/);
    });
});
