import type { IMeshModule, IMeshApp, ILogger, IServiceBroker, IServiceRegistry } from '../interfaces/index.js';
import { MeshNetwork } from '../core/MeshNetwork.js';
import { BaseTransport } from '../transports/BaseTransport.js';
import { SecurityConfig } from './SecurityModule.js';

export interface NetworkModuleOptions {
    port?: number;
    namespace?: string;
    bootstrapNodes?: string[];
    transports: BaseTransport[];
    privateKey?: string;
}

/**
 * NetworkModule — Manages the lifecycle and configuration of the Mesh Network.
 */
export class NetworkModule implements IMeshModule {
    public readonly name = 'network';
    public logger!: ILogger;
    public serviceBroker!: IServiceBroker;
    private network!: MeshNetwork;

    constructor(private options: NetworkModuleOptions) {}

    onInit(app: IMeshApp): void {
        const registry = app.getProvider<IServiceRegistry>('registry');
        if (!registry) throw new Error('[NetworkModule] Registry provider not found. Ensure RegistryModule is initialized before NetworkModule.');
        
        this.logger = app.logger;

        const securityConfig = app.hasProvider('security:config')
            ? app.getProvider<SecurityConfig>('security:config')
            : undefined;

        const privateKey = this.options.privateKey || securityConfig?.privateKey;

        // 1. Initialize the Network stack
        this.network = new MeshNetwork({
            nodeId: app.nodeID,
            port: this.options.port,
            namespace: this.options.namespace || app.namespace || 'default',
            bootstrapNodes: this.options.bootstrapNodes || [],
            transports: this.options.transports,
            privateKey
        }, this.logger, registry);

        // 2. Register provider for DI
        app.registerProvider('network', this.network);
    }

    public getNetwork(): MeshNetwork {
        return this.network;
    }

    async onStart(): Promise<void> {
        await this.network.start();
    }

    async onStop(): Promise<void> {
        if (this.network) {
            await this.network.stop();
        }
    }
}
