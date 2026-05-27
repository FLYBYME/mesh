import type { IMeshModule, IMeshApp, ILogger, IServiceBroker  } from '../interfaces';
import { ServiceRegistry } from '../core/ServiceRegistry';
import { RegistryPlugin } from '../RegistryPlugin';

/**
 * RegistryModule — Manages the lifecycle and configuration of the Service Registry.
 * Implements the "Self-Installing" pattern by piping the RegistryPlugin into the Broker.
 */
export class RegistryModule implements IMeshModule {
    public readonly name = 'registry';
    public logger!: ILogger;
    public serviceBroker!: IServiceBroker;
    private registry!: ServiceRegistry;
    private plugin!: RegistryPlugin;

    constructor(private options: { bucketSize?: number } = {}) {}

    onInit(app: IMeshApp): void {
        this.logger = app.getProvider<ILogger>('logger') || app.logger;
        this.serviceBroker = app.getProvider<IServiceBroker>('broker');

        if (!this.serviceBroker) {
            this.logger.warn('[RegistryModule] ServiceBroker not found during onInit. RegistryPlugin may not be installed.');
        }

        // 1. Initialize core registry logic
        this.registry = new ServiceRegistry(this.logger, {
            localNodeID: app.nodeID,
            dhtEnabled: true
        });

        // 2. Create the Plugin
        this.plugin = new RegistryPlugin(this.registry);

        // 3. Self-Install: Pipe into the broker
        if (this.serviceBroker) {
            this.serviceBroker.pipe(this.plugin);
            this.logger.info('[RegistryModule] RegistryPlugin successfully piped into ServiceBroker.');
        }

        // 4. Register provider for DI
        app.registerProvider('registry', this.registry);
    }

    public getRegistry(): ServiceRegistry {
        return this.registry;
    }

    async onStart(): Promise<void> {
        // Startup logic (handled by plugin.onStart via broker.start usually)
    }

    async onStop(): Promise<void> {
        if (this.registry) {
            await this.registry.stop();
        }
    }
}
