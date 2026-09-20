import type { IMeshModule, IMeshApp, ILogger, IServiceBroker, IServiceRegistry } from '../interfaces/index.js';
import { Registry } from '../core/Registry.js';
import { PRESENCE_INTERVAL_MS } from '../core/MeshOrchestrator.js';

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

        // `ttl` is how long a peer may go unheard before it is marked offline, and the only thing
        // that keeps a peer "heard" is the presence broadcast every PRESENCE_INTERVAL_MS. So a ttl
        // below that interval is not aggressive tuning -- it is a cluster that flaps: with ttl 5000
        // against a 15s presence, every peer is offline for two thirds of each cycle, calls to it
        // fail, and it is pruned and rediscovered over and over.
        //
        // Checked here rather than in `Registry`, which has no presence of its own and is
        // legitimately constructed with a tiny ttl in sweep-timing tests. This module is where a
        // registry meets a real network. Refused rather than warned about, because on a single node
        // it looks completely fine -- which is exactly how mesh-serve's `start` shipped `ttl: 5000`
        // and nothing noticed until two real nodes ran together and spent their time declaring each
        // other dead.
        if (registryOptions.ttl !== undefined && registryOptions.ttl < PRESENCE_INTERVAL_MS) {
            throw new Error(
                `[RegistryModule] ttl ${registryOptions.ttl}ms is below the presence interval (${PRESENCE_INTERVAL_MS}ms), so peers would be marked offline between their own heartbeats. Use at least ${PRESENCE_INTERVAL_MS * 2}ms, or omit ttl for the 30000ms default.`,
            );
        }

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
