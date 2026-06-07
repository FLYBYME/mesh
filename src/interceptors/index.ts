import { IInterceptor } from '../interfaces/IInterceptor.js';
import { IMeshNetwork, MeshPacket } from '../interfaces/IMeshNetwork.js';
import { AuthInterceptor } from './AuthInterceptor.js';

export * from './AuthInterceptor.js';

export type InterceptorFactory = (app: any, network: IMeshNetwork, options?: Record<string, unknown>) => IInterceptor<MeshPacket, MeshPacket>;

export const interceptors: Record<string, InterceptorFactory> = {
    auth: (app, _network) => new AuthInterceptor(app.logger),
    logging: (_app, network) => ({
        name: 'logging',
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

