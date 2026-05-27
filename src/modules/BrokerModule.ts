import type { IMeshModule, IMeshApp, ILogger, IMeshNetwork, IServiceRegistry } from '../interfaces/index.js';
import { ServiceBroker } from '../core/ServiceBroker.js';

/**
 * BrokerModule — Manages the lifecycle and configuration of the Service Broker.
 */
export class BrokerModule implements IMeshModule {
    public readonly name = 'broker';
    public logger!: ILogger;
    private broker!: ServiceBroker;

    onInit(app: IMeshApp): void {
        this.logger = app.logger;
        
        this.broker = new ServiceBroker(app.nodeID, this.logger);

        // 1. Link Registry and Network if available
        const registry = app.getProvider<IServiceRegistry>('registry');
        if (registry) {
            this.broker.setRegistry(registry);
        }

        const network = app.getProvider<IMeshNetwork>('network');
        if (network) {
            this.broker.setNetwork(network);
        }

        // 2. Register provider for DI
        app.registerProvider('broker', this.broker);
    }

    public getBroker(): ServiceBroker {
        return this.broker;
    }

    async onStart(): Promise<void> {
        await this.broker.start();
    }

    async onStop(): Promise<void> {
        if (this.broker) {
            await this.broker.stop();
        }
    }
}
