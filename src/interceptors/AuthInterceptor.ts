import { IInterceptor } from '../interfaces/IInterceptor.js';
import { MeshPacket } from '../interfaces/IMeshNetwork.js';
import { ILogger } from '../interfaces/ILogger.js';

/**
 * AuthInterceptor — verifies that the senderNodeID matches the authenticated identity of the transport peer.
 */
export class AuthInterceptor implements IInterceptor<MeshPacket, MeshPacket> {
    public readonly name = 'auth';
    
    constructor(private logger: ILogger) {}

    async onInbound(packet: MeshPacket): Promise<MeshPacket> {
        // Skip check for internal/local packets
        if (packet.meta?.local === true) {
            return packet;
        }

        const authenticatedNodeID = packet.meta?.authenticatedNodeID;
        
        // If the transport provided an authenticated identity, it must match the senderNodeID
        if (authenticatedNodeID && authenticatedNodeID !== packet.senderNodeID) {
            this.logger.warn(`[AuthInterceptor] Dropping spoofed packet from ${packet.senderNodeID} (Authenticated as ${authenticatedNodeID})`, { 
                topic: packet.topic,
                id: packet.id 
            });
            // Return a special marker to indicate dropping, or throw
            return { ...packet, topic: '__auth_failed' };
        }

        return packet;
    }

    async onOutbound(packet: MeshPacket): Promise<MeshPacket> {
        return packet;
    }
}
