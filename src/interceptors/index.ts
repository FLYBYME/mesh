import { IInterceptor } from '../interfaces/IInterceptor.js';
import { IMeshNetwork, MeshPacket } from '../interfaces/IMeshNetwork.js';

export type InterceptorFactory = (app: any, network: IMeshNetwork, options?: Record<string, unknown>) => IInterceptor<MeshPacket, MeshPacket>;

export const DefaultInterceptorRegistry: Record<string, InterceptorFactory> = {
    'log': (app, network) => ({
        name: 'log-interceptor',
        onInbound: (packet: MeshPacket) => {
            network.logger.debug(`[Inbound] ${packet.topic}`, { id: packet.id });
            return packet;
        },
        onOutbound: (packet: MeshPacket) => {
            network.logger.debug(`[Outbound] ${packet.topic}`, { id: packet.id });
            return packet;
        }
    })
};
