import { IInterceptor } from '../interfaces/IInterceptor.js';
import { IMeshApp } from '../interfaces/IMeshApp.js';
import { IMeshNetwork, MeshPacket } from '../interfaces/IMeshNetwork.js';
import { AuthInterceptorHMAC } from './AuthInterceptor.js';
import { AuthInterceptorEd25519 } from './AuthInterceptorEd25519.js';

export * from './AuthInterceptor.js';
export * from './AuthInterceptorEd25519.js';

export type InterceptorFactory = (app: IMeshApp, network: IMeshNetwork, options?: Record<string, unknown>) => IInterceptor<MeshPacket, MeshPacket>;

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
    }),
    'auth-hmac': (app, network, options) => AuthInterceptorHMAC({
        secret: (options?.secret as string) || '',
        maxAgeMs: options?.maxAgeMs as number | undefined,
        allowUnsigned: options?.allowUnsigned as boolean | undefined
    }),
    'auth-ed25519': (app, network, options) => AuthInterceptorEd25519({
        privateKey: (options?.privateKey as string) || '',
        publicKeyResolver: options?.publicKeyResolver as (nodeID: string) => Promise<string | undefined>,
        maxAgeMs: options?.maxAgeMs as number | undefined,
        allowUnsigned: options?.allowUnsigned as boolean | undefined
    })
};
