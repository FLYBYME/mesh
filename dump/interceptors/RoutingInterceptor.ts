import type { IInterceptor } from '../interfaces';
import { TransportManager } from '../core/TransportManager';
import type { MeshPacket } from '../types/packet.types';

/**
 * RoutingInterceptor - Implements Multi-Hop Routing and TTL enforcement.
 */
export class RoutingInterceptor implements IInterceptor<MeshPacket, MeshPacket> {
    public readonly name = 'routing-interceptor';

    constructor(
        private nodeID: string,
        private transport: TransportManager
    ) { }

    /**
     * Inbound Logic: Handle packets not destined for this node.
     */
    async onInbound(packet: MeshPacket): Promise<MeshPacket> {
        const meta = packet.meta as {
            ttl?: number;
            path?: string[];
            finalDestinationID?: string;
        } | undefined;

        // 1. If finalDestinationID is set and doesn't match this nodeID, forward it.
        if (meta?.finalDestinationID && meta.finalDestinationID !== this.nodeID) {
            
            // Phase 3: Skip REQUEST packets.
            // These should be handled by NetworkPlugin -> ServiceBroker (Proxy logic)
            // to ensure strict, transparent proxying with full middleware support.
            if (packet.type === 'REQUEST') {
                return packet;
            }

            const ttl = (meta.ttl ?? 5) - 1;

            if (ttl <= 0) {
                // Drop packet and log. Ideally send back an error packet.
                console.error(`[RoutingInterceptor] TTL Expired for packet ${packet.id} from ${packet.senderNodeID} to ${meta.finalDestinationID}.`);

                // Return a special topic to prevent NetworkDispatcher from processing it.
                return { ...packet, topic: '__dropped', data: undefined };
            }

            // Append current node to path tracking.
            const path = [...(meta.path ?? []), this.nodeID];

            const forwardedPacket: MeshPacket = {
                ...packet,
                meta: {
                    ...packet.meta,
                    ttl,
                    path
                }
            } as MeshPacket;

            // Hand back to TransportManager to be routed to the next closest node based on DHT/RoutingTable.
            // Note: selectBestRoute in TransportManager will find the best connection to reach finalDestinationID.
            await this.transport.send(meta.finalDestinationID, forwardedPacket as MeshPacket);

            // Return forwarded topic to signal that this packet should NOT be processed by local handlers.
            return { ...packet, topic: '__forwarded' } as MeshPacket;
        }

        return packet;
    }

    /**
     * Outbound Logic: Ensure initial routing metadata is present.
     */
    async onOutbound(packet: MeshPacket): Promise<MeshPacket> {
        const meta = packet.meta as {
            ttl?: number;
            path?: string[];
            finalDestinationID?: string;
        } | undefined;

        // If a final destination is specified but no routing metadata exists, initialize it.
        if (meta?.finalDestinationID && !meta.ttl) {
            packet.meta = {
                ...packet.meta,
                ttl: 5,
                path: []
            };
        }

        return packet;
    }
}
