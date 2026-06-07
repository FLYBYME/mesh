import { IsomorphicCrypto } from '../utils/Crypto.js';

/**
 * AuthHandshakeManager — manages the challenge-response protocol logic.
 * Transport-agnostic implementation of Ed25519-based authentication.
 */
export class AuthHandshakeManager {
    /**
     * Generates a random 16-byte hex nonce for a challenge.
     */
    static generateChallenge(): string {
        return IsomorphicCrypto.randomID(16);
    }

    /**
     * Signs a challenge nonce using the node's private key.
     */
    static async createResponse(nonce: string, privateKey: string): Promise<string> {
        return IsomorphicCrypto.signEd25519(nonce, privateKey);
    }

    /**
     * Verifies a challenge response.
     */
    static async verifyResponse(
        signature: string,
        nonce: string,
        publicKey: string
    ): Promise<boolean> {
        return IsomorphicCrypto.verifyEd25519(signature, nonce, publicKey);
    }
}
