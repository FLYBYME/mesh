import { nanoid } from 'nanoid';
import { IServiceContext } from '../services/ServiceModule';
import { IMeshApi } from '../services/api';
import { EventBus } from '../events/EventBus';
import { ServiceModuleRegistry } from '../services/ServiceModuleRegistry';
import { ServiceExecutor } from '../services/ServiceExecutor';
import { ServiceLoader } from '../services/ServiceLoader';
import { Database } from './db/Database';

export { ServiceExecutor };

/**
 * MeshEngine: The headless orchestrator of the platform.
 */
export class MeshEngine<TApi extends IMeshApi = IMeshApi> {
    public readonly events: EventBus;
    public readonly registry: ServiceModuleRegistry<TApi>;
    public readonly executor: ServiceExecutor<TApi>;
    public readonly loader: ServiceLoader<TApi>;
    public readonly db: Database;

    constructor() {
        this.events = new EventBus();
        this.registry = new ServiceModuleRegistry<TApi>();
        this.executor = new ServiceExecutor<TApi>(this.registry);
        this.loader = new ServiceLoader<TApi>(this.registry);
        this.db = new Database(this.events);
    }

    public api?: TApi;

    /**
     * boot: Starts the core services and loads service modules.
     */
    public async boot(api: TApi, servicesDir?: string): Promise<void> {
        this.api = api;

        if (servicesDir) {
            await this.loader.loadFromDirectory(servicesDir);
        }

        // Connect Database
        try {
            await this.db.connect();
        } catch (err) {
            console.warn(`[MeshEngine] Database connection failed, continuing without DB: ${err instanceof Error ? err.message : String(err)}`);
        }

        // Post-Init Services & Subscribe Events
        const context = this.createContext(api, 'system-boot');
        for (const service of this.registry.allServices()) {
            // Subscribe declarative handlers
            if ('getEventHandlers' in service && typeof service.getEventHandlers === 'function') {
                const handlers = (service as any).getEventHandlers() as Map<string, any>;
                for (const [name, handler] of handlers.entries()) {
                    console.log(`[MeshEngine] Subscribing service ${service.domain} to event: ${name}`);
                    this.events.subscribe(name as any, handler.bind(service));
                }
            }

            if (service.postInit) {
                await service.postInit(context);
            }
        }
    }

    /**
     * shutdown: Gracefully stops all services.
     */
    public async shutdown(): Promise<void> {
        console.log('[MeshEngine] Shutting down...');
        await this.db.disconnect();
        for (const service of this.registry.allServices()) {
            if ('terminate' in service && typeof service.terminate === 'function') {
                await service.terminate();
            }
        }
    }

    /**
     * createContext: Creates a strictly-typed execution context.
     */
    public createContext(
        api?: TApi,
        correlationId?: string,
        sandboxId?: string
    ): IServiceContext<TApi> {
        const self = this;
        return {
            get api(): TApi {
                if (api && Object.keys(api).length > 0) return api;
                return self.api || ({} as TApi);
            },
            events: this.events,
            services: this.registry,
            db: this.db,
            sandboxId,
            correlationId: correlationId || nanoid(),
        };
    }
}
