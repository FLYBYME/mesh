import type { IInterceptor, IServiceRegistry } from '../interfaces';
import type { MeshPacket } from '../types/packet.types';

/**
 * WorkerProxyInterceptor — Implements Hub-and-Spoke Proxy logic.
 * Proxies requests to worker nodes if the local node doesn't host the service.
 */
export class WorkerProxyInterceptor implements IInterceptor<MeshPacket, MeshPacket> {
    public readonly name = 'worker-proxy';

    constructor(
        private nodeID: string,
        private registry: IServiceRegistry,
        private hasLocalHandler: (topic: string) => boolean
    ) { }

    async onInbound(packet: MeshPacket): Promise<MeshPacket> {
        if (packet.type !== 'REQUEST' && packet.type !== 'EVENT') return packet;

        const topic = packet.topic;

        // If we have a local handler, don't proxy
        if (this.hasLocalHandler(topic)) return packet;

        const nodes = this.registry.getAvailableNodes();
        const worker = nodes.find(n =>
            n.parentID === this.nodeID &&
            n.nodeType === 'worker' &&
            n.services.some((svc) => {
                const svcName = svc.fullName || svc.name;
                return (svc.actions && Object.keys(svc.actions).some(k => k === topic || `${svcName}.${k}` === topic));
            })
        );

        if (worker) {
            return {
                ...packet,
                meta: {
                    ...packet.meta,
                    finalDestinationID: worker.nodeID,
                    isProxy: true
                }
            };
        }

        return packet;
    }
}
