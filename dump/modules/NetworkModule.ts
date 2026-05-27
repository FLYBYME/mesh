import type { IMeshModule, IMeshApp, ILogger, IServiceBroker, IServiceRegistry, IInterceptor  } from '../interfaces';
import { MeshNetwork } from '../core/MeshNetwork';
import type { MeshNetworkOptions } from '../core/MeshNetwork';
import { NetworkPlugin } from '../NetworkPlugin';
import type { MeshPacket } from '../types/packet.types';
import { RateLimitInterceptor } from '../interceptors/RateLimitInterceptor';
import { CircuitBreakerInterceptor } from '../interceptors/CircuitBreakerInterceptor';
import { WorkerProxyInterceptor } from '../interceptors/WorkerProxyInterceptor';
import { RoutingInterceptor } from '../interceptors/RoutingInterceptor';
import { TraceInterceptor } from '../interceptors/TraceInterceptor';
import { CompressionInterceptor } from '../interceptors/CompressionInterceptor';
import { BaseTransport } from '../transports/BaseTransport';

export interface InterceptorConfigEntry {
    use: string | IInterceptor<MeshPacket, MeshPacket>;
    order?: number;
    options?: Record<string, unknown>;
}

export interface NetworkModuleOptions extends Partial<Omit<MeshNetworkOptions, 'transports'>> {
    transports: BaseTransport[];
    interceptors?: Array<string | IInterceptor<MeshPacket, MeshPacket> | InterceptorConfigEntry>;
}

export type InterceptorFactory = (app: IMeshApp, network: MeshNetwork, options?: Record<string, unknown>) => IInterceptor<MeshPacket, MeshPacket>;

export const DefaultInterceptorRegistry: Record<string, InterceptorFactory> = {
    'rate-limit': (app) => new RateLimitInterceptor(app.getProvider<{ increment: (name: string, value: number, labels?: Record<string, string>) => void }>('metrics')),
    'circuit-breaker': (app) => new CircuitBreakerInterceptor(app.getProvider<{ increment: (name: string, value: number, labels?: Record<string, string>) => void }>('metrics')),
    'worker-proxy': (app, network) => new WorkerProxyInterceptor(network.nodeID, network.registry, (t) => network.dispatcher.hasHandler(t)),
    'routing': (app, network) => new RoutingInterceptor(network.nodeID, network.transport),
    'trace': () => new TraceInterceptor(),
    'compression': () => new CompressionInterceptor(),
};

/**
 * NetworkModule — Manages the lifecycle and configuration of the Mesh Network.
 * Implements the "Self-Installing" pattern by piping the NetworkPlugin into the Broker.
 */
export class NetworkModule implements IMeshModule {
    public readonly name = 'network';
    public logger!: ILogger;
    public serviceBroker!: IServiceBroker;
    private network!: MeshNetwork;
    private plugin!: NetworkPlugin;
    
    // Allow external registration of custom interceptors
    public static interceptorRegistry: Record<string, InterceptorFactory> = { ...DefaultInterceptorRegistry };

    constructor(private options: NetworkModuleOptions) {}

    onInit(app: IMeshApp): void {
        const registry = app.getProvider<IServiceRegistry>('registry');
        if (!registry) throw new Error('[NetworkModule] Registry provider not found. Ensure RegistryModule is initialized before NetworkModule.');
        
        this.logger = app.getProvider<ILogger>('logger') || app.logger;
        this.serviceBroker = app.getProvider<IServiceBroker>('broker');

        if (!this.serviceBroker) {
            this.logger.warn('[NetworkModule] ServiceBroker not found during onInit. NetworkPlugin may not be installed.');
        }

        // 1. Initialize the Network stack
        const fullOptions: MeshNetworkOptions = {
            nodeId: app.nodeID,
            port: this.options.port,
            namespace: this.options.namespace || 'default',
            bootstrapNodes: this.options.bootstrapNodes || [],
            transports: this.options.transports
        };

        this.network = new MeshNetwork(fullOptions, this.logger, registry);

        // Configure Interceptors
        const interceptorConfigs = this.options.interceptors || [
            { use: 'rate-limit', order: 10 },
            { use: 'circuit-breaker', order: 20 },
            { use: 'worker-proxy', order: 30 },
            { use: 'routing', order: 40 },
            { use: 'trace', order: 50 }
        ];

        const normalizedConfigs = interceptorConfigs.map((config) => {
            if (typeof config === 'string') {
                return { use: config, order: 100 };
            }
            if (config && typeof config === 'object' && 'use' in config) {
                return { use: config.use, order: config.order ?? 100, options: config.options };
            }
            // Direct instance
            return { use: config as IInterceptor<MeshPacket, MeshPacket>, order: 100 };
        });

        normalizedConfigs.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

        for (const config of normalizedConfigs) {
            let interceptorInstance: IInterceptor<MeshPacket, MeshPacket>;

            if (typeof config.use === 'string') {
                const factory = NetworkModule.interceptorRegistry[config.use];
                if (!factory) {
                    this.logger.warn(`[NetworkModule] Interceptor '${config.use}' not found in registry.`);
                    continue;
                }
                interceptorInstance = factory(app, this.network, config.options);
            } else {
                interceptorInstance = config.use as IInterceptor<MeshPacket, MeshPacket>;
            }

            this.network.use(interceptorInstance);
            this.logger.info(`[NetworkModule] Registered interceptor: ${interceptorInstance.name || (typeof config.use === 'string' ? config.use : 'custom')}`);
        }

        // 2. Create the Plugin
        this.plugin = new NetworkPlugin(this.network);

        // 3. Self-Install: Pipe into the broker
        if (this.serviceBroker) {
            this.serviceBroker.pipe(this.plugin);
            this.logger.debug('[NetworkModule] NetworkPlugin successfully piped into ServiceBroker.');
        }

        // 4. Register provider for DI
        app.registerProvider('network', this.network);
    }

    public getNetwork(): MeshNetwork {
        return this.network;
    }

    async onStart(): Promise<void> {
        // Startup logic is handled by plugin.onStart via broker.start()
    }

    async onStop(): Promise<void> {
        if (this.network) {
            await this.network.stop();
        }
    }
}
