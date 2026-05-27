import type { IInterceptor } from '../interfaces';
import type { MeshPacket } from '../types/packet.types';

/**
 * TraceInterceptor — Hydrates and injects distributed tracing context.
 * Adheres to strict typing for tracing metadata.
 */
export class TraceInterceptor implements IInterceptor<MeshPacket, MeshPacket> {
    public readonly name = 'trace-interceptor';

    /**
     * Inbound: Extract tracing context from packet metadata to hydrate the mesh context.
     */
    onInbound(packet: MeshPacket): MeshPacket {
        // If tracing meta exists, we ensure it's available for the ServiceBroker to pick up.
        // The ServiceBroker will use these fields to populate the IContext.
        const meta = packet.meta as Record<string, unknown> | undefined;
        if (meta?.traceId) {
            return {
                ...packet,
                meta: {
                    ...meta,
                    traceId: meta.traceId,
                    spanId: meta.spanId,
                    parentId: meta.parentId
                }
            };
        }

        return packet;
    }

    /**
     * Outbound: Inject current tracing context into packet metadata.
     */
    onOutbound(packet: MeshPacket): MeshPacket {
        // The ServiceBroker should have already initialized tracing in the packet meta
        // if it originated from a context with tracing enabled.
        const meta = packet.meta as Record<string, unknown> | undefined;
        if (meta?.traceId) {
            return {
                ...packet,
                meta: {
                    ...meta,
                    traceId: meta.traceId,
                    spanId: meta.spanId,
                    parentId: meta.parentId
                }
            };
        }

        return packet;
    }
}
