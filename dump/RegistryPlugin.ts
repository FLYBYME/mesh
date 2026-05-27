import type { IBrokerPlugin, IServiceBroker, IServiceRegistry, IContext  } from './interfaces';

/**
 * RegistryPlugin — Resolves targetNodeID in the GLOBAL pipeline.
 */
export class RegistryPlugin implements IBrokerPlugin {
    public readonly name = 'registry-plugin';

    constructor(private registry: IServiceRegistry) {}

    onRegister(broker: IServiceBroker): void {
        broker.setRegistry(this.registry);

        // Global Middleware: Determine destination
        broker.use(async (ctx: IContext<Record<string, unknown>, Record<string, unknown>>, next: () => Promise<unknown>) => {
            if (!ctx.targetNodeID) {
                const endpoint = this.registry.selectNode(ctx.actionName, { 
                    action: ctx.actionName, 
                    params: ctx.params 
                });

                if (endpoint) {
                    ctx.targetNodeID = endpoint.nodeID;
                }
            }

            return await next();
        });

        broker.app.registerProvider('registry', this.registry);
    }

    async onStart(): Promise<void> {
        await this.registry.start();
    }

    async onStop(): Promise<void> {
        await this.registry.stop();
    }
}
