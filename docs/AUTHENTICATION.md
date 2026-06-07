# Authentication & Security

## Overview

Mesh implements a **Zero-Trust** security model. Every connection between nodes is mutually authenticated using Ed25519 digital signatures, and every packet is verified to prevent identity spoofing.

---

## Security Architecture

The security system consists of three main components:

1.  **Mutual Authentication (Handshake)**: When two nodes connect (via WebSockets or TCP), they perform a challenge-response handshake. Both sides must prove they possess the private key corresponding to the public key registered in the cluster.
2.  **Identity Verification (AuthInterceptor)**: Every inbound packet is checked against the transport's authenticated identity. This prevents a compromised node from claiming to be a different `nodeID` in its packet headers.
3.  **Security Module**: A standard Mesh module that manages the node's cryptographic keys and provides them to the network stack.

---

## Configuration

### Using the CLI

To start a secured node, provide your Ed25519 keys via the command line:

```bash
mesh start \
  --node-id alice \
  --private-key "MC4CAQAwBQYDK2VwBCIEINT652f1yC5v9xS7q5M0HlXqL6m7i9Y4f8G5u6v7w8x9" \
  --public-key "MCowBQYDK2VwAyEA9f652f1yC5v9xS7q5M0HlXqL6m7i9Y4f8G5u6v7w8x9"
```

### Programmatic Setup

When building a `MeshApp` manually, use the `SecurityModule`:

```typescript
import { MeshApp, SecurityModule, NetworkModule, WSTransport, JSONSerializer } from '@flybyme/mesh';

const app = new MeshApp({ nodeID: 'alice' });

// 1. Register Security Module
app.use(new SecurityModule({
    privateKey: '...', // Ed25519 Base64
    publicKey: '...'   // Ed25519 Base64
}));

// 2. Network Module automatically picks up keys from SecurityModule
app.use(new NetworkModule({
    port: 7001,
    transports: [new WSTransport(new JSONSerializer(), 7001)]
}));

await app.start();
```

---

## Mutual Authentication Handshake

The handshake follows these steps:

1.  **Server Challenge**: Immediately upon connection, the server sends an `AUTH` packet containing a random 16-byte nonce.
2.  **Client Response**: The client signs the server's nonce with its private key and sends an `AUTH` response containing the signature and its own random challenge nonce.
3.  **Server Verification & Response**: The server verifies the client's signature. If valid, it signs the client's nonce and sends its own `AUTH` response.
4.  **Client Verification**: The client verifies the server's signature.

If any verification fails, the connection is immediately terminated. Until the handshake is complete, the transport "chokes" all non-authentication packets.

---

## Identity Spoofing Protection

Even after authentication, the `AuthInterceptor` provides continuous protection.

Every `MeshPacket` has a `senderNodeID` field. Without protection, a node could claim to be any other node. The `AuthInterceptor` cross-references the `senderNodeID` in every inbound packet with the `nodeID` verified during the transport handshake.

If they do not match, the packet is dropped and a warning is logged:
`[AuthInterceptor] Dropping spoofed packet from bob (Authenticated as charlie)`

---

## Generating Keys

Mesh uses standard Ed25519 keys (PKCS#8 for private, SPKI for public). You can generate these using standard crypto libraries or utilities.

*Example (Node.js):*
```javascript
const { generateKeyPairSync } = require('node:crypto');
const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' }
});

console.log('Public Key:', publicKey.toString('base64'));
console.log('Private Key:', privateKey.toString('base64'));
```
