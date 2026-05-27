import type {
    IMeshApp,
    IMeshModule,
    AppConfig,
    IProviderToken,
    IContext,
    ILogger,
    IServiceBroker,
    IServiceRegistry,
    IMiddleware
} from '../interfaces';
import { LogLevel } from '../interfaces';
import { BootOrchestrator } from './BootOrchestrator';
import { ConsoleLogger } from '../utils/ConsoleLogger';
import type { IServiceModule } from '../services/ServiceModule';

/**
 * MeshApp — The "Motherboard" shell that provides DI and lifecycle management.
 */
export class MeshApp implements IMeshApp {
    public readonly nodeID: string;
    public readonly namespace: string;
    public readonly config: AppConfig;
    public readonly logger: ILogger;

    protected modules: IMeshModule[] = [];
    protected pendingMiddleware: ((ctx: IContext<Record<string, unknown>, Record<string, unknown>>, next: () => Promise<unknown>) => Promise<unknown>)[] = [];
    protected providers = new Map<string, unknown>();
    protected pendingModules: IServiceModule[] = [];
    public orchestrator: BootOrchestrator;

    constructor(config: AppConfig) {
        this.nodeID = config.nodeID;
        this.namespace = config.namespace || 'default';
        this.config = config;
        this.orchestrator = new BootOrchestrator(this as unknown as IMeshApp);

        // Use the ConsoleLogger as default if config.logger is not provided
        this.logger = config.logger || new ConsoleLogger({}, LogLevel.INFO);
        // Ensure logger is prefixed with nodeID for better context
        this.logger = this.logger.child({ nodeID: this.nodeID, namespace: this.namespace });

        this.registerProvider<ILogger>('logger', this.logger);
        this.registerProvider<IMeshApp>('app', this as unknown as IMeshApp);
    }

    public get registry(): IServiceRegistry {
        return this.getProvider<IServiceRegistry>('registry');
    }

    public getConfig(): AppConfig {
        return this.config;
    }

    public use(moduleOrMiddleware: IMeshModule | ((ctx: IContext<Record<string, unknown>, Record<string, unknown>>, next: () => Promise<unknown>) => Promise<unknown>)): this {
        if (typeof moduleOrMiddleware === 'function') {
            if (this.hasProvider('broker')) {
                const broker = this.getProvider<IServiceBroker>('broker');
                broker.use(moduleOrMiddleware as IMiddleware);
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
            if ('id' in token && token.id) return String(token.id);
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
                broker.use(this.pendingMiddleware.shift()!);
            }
            while (this.pendingModules.length > 0) {
                const mod = this.pendingModules.shift();
                if (mod) {
                    broker.registerModule(mod).catch(err => {
                        this.logger.error(`[MeshApp] Failed to register pending module: ${mod.name}`, { error: err.message });
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
        this.logger.info('MeshApp starting...');
        await this.orchestrator.executeBootSequence(this.modules);
        this.logger.info('MeshApp started successfully.');
    }

    public async call(action: string, params: unknown, opts?: any): Promise<unknown> {
        const broker = this.getProvider<IServiceBroker>('broker');
        return broker.call(action, params, opts);
    }

    public async publish<T = unknown>(topic: string, data: T): Promise<void> {
        if (this.hasProvider('broker')) {
            const broker = this.getProvider<IServiceBroker>('broker');
            broker.emit(topic, data);
        } else {
            this.logger.warn(`[MeshApp] Cannot publish to ${topic}, broker not initialized.`);
        }
    }

    public emit(event: string, payload: unknown): void {
        const broker = this.getProvider<IServiceBroker>('broker');
        broker.emit(event, payload);
    }

    public async stop(): Promise<void> {
        this.logger.info('MeshApp stopping...');
        await this.orchestrator.executeTeardown(this.modules);
        this.logger.info('MeshApp stopped.');
    }
}

/**
 * Factory for creating a MeshApp instance.
 */
export function createMeshApp(config: AppConfig & { modules?: IMeshModule[] }): MeshApp {
    const app = new MeshApp(config);
    if (config.modules) {
        for (const mod of config.modules) {
            app.use(mod);
        }
    }
    return app;
}
