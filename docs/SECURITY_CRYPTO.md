# Security & Crypto Specification

## Overview
Security in Mesh is built around cryptographic identity and payload integrity. It utilizes a unified `IsomorphicCrypto` utility to provide consistent cryptographic primitives across Node.js and the Browser.

## Cryptographic Primitives
Mesh relies on the **WebCrypto API**:
- **Node.js**: Uses `node:crypto.webcrypto`.
- **Browser**: Uses `globalThis.crypto.subtle`.

## Key Features

### 1. Identity & Signing
Mesh uses **Ed25519** (Edwards-curve Digital Signature Algorithm) for high-performance, low-latency signing and verification.
- **Node Keys**: Every node can be assigned a private/public key pair.
- **Packet Signing**: Outbound packets can be signed to ensure they originated from a trusted node.
- **Verification**: Inbound packets are verified against the sender's public key stored in the `ServiceRegistry`.

### 2. Randomness
- **Nonces**: Secure random IDs (16-32 bytes) are generated for packet correlation and trace IDs using `getRandomValues()`.
- **Fallback**: In non-secure contexts or legacy environments, a `Math.random` fallback is provided, though not recommended for production.

### 3. Encoding
Isomorphic Base64 utilities handle binary-to-string conversions:
- **`toBase64`**: Uses `btoa` in the browser and `Buffer.toString('base64')` in Node.
- **`fromBase64`**: Uses `atob` in the browser and `Buffer.from(..., 'base64')` in Node.

### 4. Payload Security
- **Data Redaction**: Interceptors can be registered to sanitize sensitive fields before they reach the `LogInterceptor`.
- **Auth Metadata**: The `IMeshAuthMeta` interface allows attaching authentication tokens (e.g., JWT) to every call, which are validated by the `Local Pipeline` middleware in the `ServiceBroker`.

## Trust Levels
The `ServiceRegistry` tracks the `trustLevel` of each node:
- `internal`: Nodes within the same secure VPC/environment.
- `public`: Untrusted nodes (e.g., external clients).
- `user`: Authenticated user-provided nodes.

## Implementation Details
```typescript
class IsomorphicCrypto {
    static async signEd25519(payload: string, privateKey: string): Promise<string>;
    static async verifyEd25519(sig: string, payload: string, publicKey: string): Promise<boolean>;
    static randomID(len: number): string;
}
```
