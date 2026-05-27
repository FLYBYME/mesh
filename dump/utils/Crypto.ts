/**
 * WebCrypto-based cryptographic utilities (Isomorphic/Browser-safe).
 */
export class IsomorphicCrypto {
    private static async getCrypto(): Promise<Crypto | null> {
        if (typeof globalThis !== 'undefined' && globalThis.crypto) {
            return globalThis.crypto;
        }
        
        // Use a conditional import for Node environments
        try {
            if (typeof process !== 'undefined' && process.versions && process.versions.node) {
                const nodeCrypto = await import('node:crypto');
                return (nodeCrypto.webcrypto as unknown as Crypto);
            }
        } catch {
            // Ignore if not in node or import fails
        }
        return null;
    }

    /** Generate a random ID string */
    static randomID(len = 16): string {
        const bytes = new Uint8Array(len / 2);
        const crypto = typeof globalThis !== 'undefined' ? globalThis.crypto : null;

        if (crypto) {
            crypto.getRandomValues(bytes);
        } else {
            // Fallback for environments where Crypto is not yet available sync
            for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
        }
        return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    /** Sign data using Ed25519 private key (Base64) */
    static async signEd25519(payload: string | Uint8Array, privateKeyB64: string): Promise<string> {
        const crypto = await this.getCrypto();
        if (!crypto) throw new Error('WebCrypto not available');
        
        const privKeyBuf = this.fromBase64(privateKeyB64);
        const key = await crypto.subtle.importKey(
            'pkcs8',
            privKeyBuf as unknown as BufferSource,
            { name: 'Ed25519' },
            false,
            ['sign']
        );

        const data = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
        const signature = await crypto.subtle.sign(
            { name: 'Ed25519' },
            key,
            data as unknown as BufferSource
        );

        return this.toBase64(new Uint8Array(signature));
    }

    /** Verify Ed25519 signature */
    static async verifyEd25519(signatureB64: string, payload: string | Uint8Array, publicKeyB64: string): Promise<boolean> {
        const crypto = await this.getCrypto();
        if (!crypto) return false;

        try {
            const pubKeyBuf = this.fromBase64(publicKeyB64);
            const key = await crypto.subtle.importKey(
                'spki',
                pubKeyBuf as unknown as BufferSource,
                { name: 'Ed25519' },
                false,
                ['verify']
            );

            const data = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
            const signature = this.fromBase64(signatureB64);

            return await crypto.subtle.verify(
                { name: 'Ed25519' },
                key,
                signature as unknown as BufferSource,
                data as unknown as BufferSource
            );
        } catch {
            return false;
        }
    }

    /** Helper: bytes to Base64 (isomorphic) */
    static toBase64(bytes: Uint8Array): string {
        // Prefer globalThis.btoa if available (browser or modern node)
        if (typeof globalThis !== 'undefined' && typeof globalThis.btoa === 'function') {
            const binString = Array.from(bytes).map(x => String.fromCharCode(x)).join('');
            return globalThis.btoa(binString);
        }
        if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
        return '';
    }

    /** Helper: Base64 to Uint8Array (isomorphic) */
    static fromBase64(b64: string): Uint8Array {
        if (typeof globalThis !== 'undefined' && typeof globalThis.atob === 'function') {
            const binString = globalThis.atob(b64);
            return Uint8Array.from(binString, (m) => m.charCodeAt(0));
        }
        if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
        return new Uint8Array(0);
    }
}
