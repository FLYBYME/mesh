import type { IMeshModule, IMeshApp, ILogger, IServiceBroker, IServiceRegistry } from '../interfaces/index.js';
import { Registry } from '../core/Registry.js';

type RegistryOptions = { preferLocal?: boolean; dhtEnabled?: boolean; ttl?: number; pruneInterval?: number; localNodeID?: string; namespace?: string };
type RegistryClass = new (logger: ILogger, options: RegistryOptions) => IServiceRegistry;

/**
 * RegistryModule — Manages the lifecycle and configuration of the Service Registry.
 *
 * `implementation` is the actual swap point for `PlacementRegistry` (`core/PlacementRegistry.ts`):
 * pass the class, not an instance -- `onInit` doesn't know `app.nodeID`/`app.namespace` until the
 * app itself constructs this module, so the registry can't be built any earlier than here. Defaults
 * to `Registry`, unchanged, so nothing existing has to opt into anything.
 */
export class RegistryModule implements IMeshModule {
    public readonly name = 'registry';
    public logger!: ILogger;
    public serviceBroker!: IServiceBroker;
    private registry!: IServiceRegistry;
    private readonly implementation: RegistryClass;
    private readonly registryOptions: RegistryOptions;

    constructor(options: RegistryOptions & { implementation?: RegistryClass } = {}) {
        const { implementation, ...registryOptions } = options;
        this.implementation = implementation ?? Registry;
        this.registryOptions = registryOptions;
    }

    onInit(app: IMeshApp): void {
        this.logger = app.logger;

        // 1. Initialize core registry logic
        this.registry = new this.implementation(this.logger, {
            localNodeID: app.nodeID,
            namespace: app.namespace,
            ...this.registryOptions
        });

        // 2. Register provider for DI
        app.registerProvider('registry', this.registry);
    }

    public getRegistry(): IServiceRegistry {
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
