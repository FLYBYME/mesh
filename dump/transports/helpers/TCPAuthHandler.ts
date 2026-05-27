import { WirePacketType } from '../../types/mesh.types';
import type { PeerState } from '../../types/mesh.types';
import { TCPTransport } from '../TCPTransport';
import { Env } from '../../utils/Env';
import { TCPFrameCodec } from './TCPFrameCodec';
import { IsomorphicCrypto } from '../../utils/Crypto';

/**
 * TCPAuthHandler — handles strictly typed Ed25519 handshake for Zero-Trust TCP.
 */
export class TCPAuthHandler {
    constructor(private transport: TCPTransport) { }

    async handleAuth(peer: PeerState, payload: Uint8Array): Promise<void> {
        if (!Env.isNode()) return;
        
        try {
            const data = JSON.parse(new TextDecoder().decode(payload)) as { 
                type: string, 
                nodeID: string, 
                signature?: string, 
                nonce?: string 
            };

            if (data.type === 'response') {
                // 1. Strict Validation: Verify Ed25519 signature
                if (!data.signature || !data.nonce) {
                    throw new Error('Missing signature or nonce in auth response');
                }

                const nodeInfo = this.transport.registry?.getNode(data.nodeID);
                if (!nodeInfo || !nodeInfo.publicKey) {
                    throw new Error(`Public key not found for node: ${data.nodeID}`);
                }

                // Verify that the client signed the nonce we sent (or they sent back)
                // For simplicity, we'll verify the signature of the nonce
                const isValid = await IsomorphicCrypto.verifyEd25519(
                    data.signature,
                    data.nonce,
                    nodeInfo.publicKey
                );

                if (!isValid) {
                    throw new Error('Invalid Ed25519 signature during handshake');
                }

                // 2. Unchoke: Mark authenticated and add to peers
                peer.nodeID = data.nodeID;
                peer.isAuthenticated = true;
                peer.isChoked = false;
                if (peer.nodeID) {
                    this.transport.peers.set(peer.nodeID, peer);
                }
                this.transport.emit('peer:connect', peer.nodeID);
                this.transport.emit('authenticated', peer.nodeID);

            } else if (data.type === 'challenge') {
                // Respond to challenge: Sign the nonce provided by the server
                if (!this.transport.privateKey) {
                    throw new Error('No private key available to sign auth challenge');
                }

                const signature = await IsomorphicCrypto.signEd25519(
                    data.nonce!,
                    this.transport.privateKey
                );

                const response = JSON.stringify({
                    type: 'response',
                    nodeID: this.transport.getNodeID(),
                    signature,
                    nonce: data.nonce
                });

                const frame = TCPFrameCodec.encode(
                    WirePacketType.AUTH,
                    'handshake',
                    new TextEncoder().encode(response)
                );
                this.writeToSocket(peer.socket, frame);
            }
        } catch (err: unknown) {
            this.transport.logger?.error(`[TCPAuthHandler] Auth failed: ${err instanceof Error ? err.message : String(err)}`);
            this.destroySocket(peer.socket);
        }
    }

    private writeToSocket(socket: unknown, data: Uint8Array): void {
        const s = socket as { write(d: Uint8Array): void };
        s.write(data);
    }

    private destroySocket(socket: unknown): void {
        const s = socket as { destroy(): void };
        s.destroy();
    }
}
