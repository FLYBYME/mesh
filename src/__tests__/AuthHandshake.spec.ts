import { AuthHandshakeManager } from '../core/AuthHandshakeManager.js';
import { IsomorphicCrypto } from '../utils/Crypto.js';

describe('AuthHandshakeManager', () => {
    // Standard Ed25519 keypair for testing (Base64)
    // Private key is PKCS#8, Public key is SPKI
    const testPrivKey = 'MC4CAQAwBQYDK2VwBCIEINT652f1yC5v9xS7q5M0HlXqL6m7i9Y4f8G5u6v7w8x9';
    const testPubKey = 'MCowBQYDK2VwAyEA9f652f1yC5v9xS7q5M0HlXqL6m7i9Y4f8G5u6v7w8x9';

    // Since Ed25519 keys are complex to generate manually in Base64 for tests,
    // we might need to use real keys or mock the crypto if needed.
    // However, IsomorphicCrypto is already tested.

    it('should generate a 16-character hex challenge', () => {
        const challenge = AuthHandshakeManager.generateChallenge();
        expect(challenge).toHaveLength(16);
        expect(challenge).toMatch(/^[0-9a-f]+$/);
    });

    it('should create and verify a valid response', async () => {
        // We'll use random IDs for keys since we just want to test the flow
        // and IsomorphicCrypto handles the actual crypto logic.
        
        // In a real test we'd need valid Ed25519 keys.
        // For now, let's assume we can generate a pair for testing if needed.
        // But for this unit test, let's mock the crypto to test the manager's orchestration.
        
        const nonce = 'test-nonce-12345';
        const signature = 'mock-signature';
        
        const signSpy = jest.spyOn(IsomorphicCrypto, 'signEd25519').mockResolvedValue(signature);
        const verifySpy = jest.spyOn(IsomorphicCrypto, 'verifyEd25519').mockResolvedValue(true);

        const response = await AuthHandshakeManager.createResponse(nonce, 'priv-key');
        expect(response).toBe(signature);
        expect(signSpy).toHaveBeenCalledWith(nonce, 'priv-key');

        const isValid = await AuthHandshakeManager.verifyResponse(signature, nonce, 'pub-key');
        expect(isValid).toBe(true);
        expect(verifySpy).toHaveBeenCalledWith(signature, nonce, 'pub-key');

        signSpy.mockRestore();
        verifySpy.mockRestore();
    });
});
