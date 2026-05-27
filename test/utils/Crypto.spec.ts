import { IsomorphicCrypto } from '../../src/utils/Crypto.js';

describe('IsomorphicCrypto', () => {
    describe('randomID', () => {
        it('should generate a random hex string of specified length', () => {
            const id1 = IsomorphicCrypto.randomID(16);
            const id2 = IsomorphicCrypto.randomID(16);
            expect(id1).toHaveLength(16);
            expect(id2).toHaveLength(16);
            expect(id1).not.toBe(id2);
            expect(/^[0-9a-f]+$/.test(id1)).toBe(true);
        });

        it('should default to length 16', () => {
            const id = IsomorphicCrypto.randomID();
            expect(id).toHaveLength(16);
        });
    });

    describe('Base64 helpers', () => {
        it('should encode and decode correctly', () => {
            const data = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
            const b64 = IsomorphicCrypto.toBase64(data);
            expect(b64).toBe('SGVsbG8=');
            const decoded = IsomorphicCrypto.fromBase64(b64);
            expect(decoded).toEqual(data);
        });

        it('should handle empty data', () => {
            expect(IsomorphicCrypto.toBase64(new Uint8Array(0))).toBe('');
            expect(IsomorphicCrypto.fromBase64('')).toEqual(new Uint8Array(0));
        });
    });

    describe('Ed25519 signing and verification', () => {
        // Test keys (Generated for testing)
        // Public Key (SPKI Base64)
        const publicKeyB64 = 'MCowBQYDK2VwAyEAL72+1vUuL2S572J9l5pY7/5Z4z5L5j7l7j5L5j7l7j4='; 
        // Note: The above key is likely invalid format for Ed25519, I should generate real ones if needed.
        // WebCrypto requires valid PKCS8 and SPKI.
        
        // Actually, let's use the real crypto to generate a key pair for the test if possible,
        // but Ed25519 generation is also async and might be restricted in some environments.
        
        it('should sign and verify data', async () => {
            const crypto = (await import('node:crypto')).webcrypto as unknown as Crypto;
            const keyPair = await crypto.subtle.generateKey(
                { name: 'Ed25519' },
                true,
                ['sign', 'verify']
            );

            const privateKeyB64 = IsomorphicCrypto.toBase64(new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)));
            const publicKeyB64 = IsomorphicCrypto.toBase64(new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey)));

            const payload = 'test-payload';
            const signature = await IsomorphicCrypto.signEd25519(payload, privateKeyB64);
            expect(signature).toBeDefined();

            const isValid = await IsomorphicCrypto.verifyEd25519(signature, payload, publicKeyB64);
            expect(isValid).toBe(true);
        });

        it('should return false for invalid signature', async () => {
            const crypto = (await import('node:crypto')).webcrypto as unknown as Crypto;
            const keyPair = await crypto.subtle.generateKey(
                { name: 'Ed25519' },
                true,
                ['sign', 'verify']
            );
            const publicKeyB64 = IsomorphicCrypto.toBase64(new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey)));
            
            const isValid = await IsomorphicCrypto.verifyEd25519('invalid-sig', 'payload', publicKeyB64);
            expect(isValid).toBe(false);
        });

        it('should handle Uint8Array payload', async () => {
            const crypto = (await import('node:crypto')).webcrypto as unknown as Crypto;
            const keyPair = await crypto.subtle.generateKey(
                { name: 'Ed25519' },
                true,
                ['sign', 'verify']
            );

            const privateKeyB64 = IsomorphicCrypto.toBase64(new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)));
            const publicKeyB64 = IsomorphicCrypto.toBase64(new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey)));

            const payload = new Uint8Array([1, 2, 3, 4]);
            const signature = await IsomorphicCrypto.signEd25519(payload, privateKeyB64);
            const isValid = await IsomorphicCrypto.verifyEd25519(signature, payload, publicKeyB64);
            expect(isValid).toBe(true);
        });
    });
});
