import type { IBrokerPlugin, IServiceBroker, IMeshNetwork, IContext } from './interfaces';

/**
 * Internal interface for errors with a code property.
 */
interface MeshErrorCode extends Error {
    code?: string | number;
}

/**
 * NetworkPlugin — The Global Sink/Source.
 * ZERO 'any' casts.
 */
export class NetworkPlugin implements IBrokerPlugin {
    public readonly name = 'network-plugin';

    constructor(private network: IMeshNetwork) { }

    onRegister(broker: IServiceBroker): void {
        broker.setNetwork(this.network);

        // 1. Inbound Flow (Source) with Error Boundary
        this.network.onMessage('*', async (data, packet) => {
            if (packet.type === 'REQUEST') {
                if (packet.senderNodeID === broker.app.nodeID) return;
                
                // Phase 3: Ignore packets handled by RoutingInterceptor (forwarded or dropped)
                if (packet.topic === '__forwarded' || packet.topic === '__dropped') return;

                broker.app.logger.info(`[NetworkPlugin] Incoming RPC: ${packet.topic} from ${packet.senderNodeID} (ID: ${packet.id})`);

                try {
                    const result = await broker.handleIncomingRPC(packet);
                    await this.network.send(packet.senderNodeID, '$rpc.response', result, {
                        id: packet.id,
                        type: 'RESPONSE',
                        meta: { correlationID: packet.id }
                    });
                    broker.app.logger.debug(`[NetworkPlugin] Sent SUCCESS response for ${packet.id} to ${packet.senderNodeID}`);
                } catch (err: unknown) {
                    const message = err instanceof Error ? err.message : 'Unknown RPC Error';
                    let code: string | number = 'RPC_ERROR';

                    if (err instanceof Error && 'code' in err) {
                        const codedError = err as MeshErrorCode;
                        if (codedError.code !== undefined) code = codedError.code;
                    }

                    await this.network.send(packet.senderNodeID, '$rpc.response', null, {
                        id: packet.id,
                        type: 'RESPONSE_ERROR',
                        error: { message, code },
                        meta: { correlationID: packet.id }
                    });
                    broker.app.logger.error(`[NetworkPlugin] Sent ERROR response for ${packet.id} to ${packet.senderNodeID}: ${message}`);
                }
            }
        });

        // 2. Outbound Sink (Middleware)
        broker.use(async (ctx: IContext<unknown, Record<string, unknown>>, next: () => Promise<unknown>) => {
            if (ctx.targetNodeID && ctx.targetNodeID !== broker.app.nodeID) {
                const response = await broker.executeRemote(
                    ctx.targetNodeID,
                    ctx.actionName,
                    ctx.params,
                    { ...ctx.meta, correlationID: ctx.correlationID }
                );
                ctx.result = response;
                return response;
            }
            return await next();
        });
    }

    async onStart(): Promise<void> {
        await this.network.start();
    }

    async onStop(): Promise<void> {
        await this.network.stop();
    }
}
