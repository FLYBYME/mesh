import type { IMeshModule, IMeshApp, ILogger, IServiceBroker } from '../interfaces/index.js';
import { Registry } from '../core/Registry.js';

/**
 * RegistryModule — Manages the lifecycle and configuration of the Service Registry.
 */
export class RegistryModule implements IMeshModule {
    public readonly name = 'registry';
    public logger!: ILogger;
    public serviceBroker!: IServiceBroker;
    private registry!: Registry;

    constructor(private options: { preferLocal?: boolean; dhtEnabled?: boolean; ttl?: number } = {}) {}

    onInit(app: IMeshApp): void {
        this.logger = app.logger;
        
        // 1. Initialize core registry logic
        this.registry = new Registry(this.logger, {
            localNodeID: app.nodeID,
            namespace: app.namespace,
            ...this.options
        });

        // 2. Register provider for DI
        app.registerProvider('registry', this.registry);
    }

    public getRegistry(): Registry {
        return this.registry;
    }

    async onStart(): Promise<void> {
        await this.registry.start();
    }

    async onStop(): Promise<void> {
        if (this.registry) {
            await this.registry.stop();
        }
    }
}
