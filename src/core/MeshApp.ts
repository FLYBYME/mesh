import type {
    IMeshApp,
    IMeshModule,
    AppConfig,
    IProviderToken,
    ILogger,
    IServiceBroker,
    IServiceRegistry
} from '../interfaces/index.js';
import { BootOrchestrator } from './BootOrchestrator.js';
import { Logger } from '../utils/Logger.js';
import type { IServiceModule } from '../interfaces/IServiceModule.js';

/**
 * MeshApp — The "Motherboard" shell that provides DI and lifecycle management.
 */
export class MeshApp implements IMeshApp {
    public readonly nodeID: string;
    public readonly namespace: string;
    public readonly config: AppConfig;
    public readonly logger: ILogger;

    protected modules: IMeshModule[] = [];
    protected pendingMiddleware: ((ctx: any, next: () => Promise<unknown>) => Promise<unknown>)[] = [];
    protected providers = new Map<string, unknown>();
    protected pendingModules: IServiceModule[] = [];
    public orchestrator: BootOrchestrator;

    constructor(config: AppConfig) {
        this.nodeID = config.nodeID;
        this.namespace = config.namespace || 'default';
        this.config = config;
        this.orchestrator = new BootOrchestrator(this);

        // Use the Logger as default if config.logger is not provided
        this.logger = config.logger || new Logger();
        // Ensure logger is prefixed with nodeID for better context
        // Note: Assuming Logger has a method to add context if needed, 
        // but for now we just use it directly as in the demo.

        this.registerProvider<ILogger>('logger', this.logger);
        this.registerProvider<IMeshApp>('app', this);
    }

    public get registry(): IServiceRegistry {
        return this.getProvider<IServiceRegistry>('registry');
    }

    public getConfig(): AppConfig {
        return this.config;
    }

    public use(moduleOrMiddleware: IMeshModule | ((ctx: any, next: () => Promise<unknown>) => Promise<unknown>)): this {
        if (typeof moduleOrMiddleware === 'function') {
            if (this.hasProvider('broker')) {
                const broker = this.getProvider<IServiceBroker>('broker');
                broker.use(moduleOrMiddleware as any);
            } else {
                this.pendingMiddleware.push(moduleOrMiddleware);
            }
        } else {
            this.modules.push(moduleOrMiddleware);
        }
        return this;
    }

    public async registerModule(module: IServiceModule): Promise<this> {
        if (this.hasProvider('broker')) {
            const broker = this.getProvider<IServiceBroker>('broker');
            await broker.registerModule(module);
        } else {
            this.pendingModules.push(module);
        }
        return this;
    }

    private getTokenKey<T>(token: IProviderToken<T>): string {
        if (typeof token === 'string' || typeof token === 'symbol') {
            return token.toString();
        }
        if (typeof token === 'function' || (typeof token === 'object' && token !== null)) {
            if ('id' in token && (token as any).id) return String((token as any).id);
            if ('name' in token && typeof token.name === 'string' && token.name !== 'Function' && token.name !== 'Object') return token.name;
        }

        throw new Error(`[MeshApp] Invalid provider token. Use a string, symbol, or a class/function with a stable name/id.`);
    }

    public hasProvider<T>(token: IProviderToken<T>): boolean {
        try {
            const key = this.getTokenKey(token);
            return this.providers.has(key);
        } catch {
            return false;
        }
    }

    public registerProvider<T>(token: IProviderToken<T>, provider: T): void {
        const key = this.getTokenKey(token);
        this.providers.set(key, provider);

        if (key === 'broker') {
            const broker = provider as IServiceBroker;
            while (this.pendingMiddleware.length > 0) {
                broker.use(this.pendingMiddleware.shift()! as any);
            }
            while (this.pendingModules.length > 0) {
                const mod = this.pendingModules.shift();
                if (mod) {
                    broker.registerModule(mod).catch((err: unknown) => {
                        this.logger.error(`[MeshApp] Failed to register pending module: ${mod.domain}`, { error: err instanceof Error ? err.message : String(err) });
                    });
                }
            }
        }
    }

    public getProvider<T>(token: IProviderToken<T>): T {
        const key = this.getTokenKey(token);
        const provider = this.providers.get(key);
        if (provider === undefined) {
            throw new Error(`[MeshApp] Provider not found for token: ${key}`);
        }
        return provider as T;
    }

    public async start(): Promise<void> {
        // Test change
        this.logger.info('MeshApp starting...');
        await this.orchestrator.executeBootSequence(this.modules);
        this.logger.info('MeshApp started successfully.');
    }

    public async stop(): Promise<void> {
        this.logger.info('MeshApp stopping...');
        await this.orchestrator.executeTeardown(this.modules);
        this.logger.info('MeshApp stopped.');
    }

    public async call<K extends keyof IServiceToolRegistry>(
        tool: K,
        params: IServiceToolRegistry[K]['params'],
        options?: { nodeID?: string; timeout?: number }
    ): Promise<IServiceToolRegistry[K]['returns']> {
        const broker = this.getProvider<IServiceBroker>('broker');
        return broker.call(tool, params, options);
    }

    public async publish<K extends keyof EventRegistry>(event: K, payload: EventRegistry[K], options?: { skipNetwork?: boolean }): Promise<void> {
        if (this.hasProvider('broker')) {
            const broker = this.getProvider<IServiceBroker>('broker');
            broker.emit(event, payload, options);
        } else {
            this.logger.warn(`[MeshApp] Cannot publish to ${String(event)}, broker not initialized.`);
        }
    }
}
