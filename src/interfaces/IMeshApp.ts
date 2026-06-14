import type { IMeshModule } from './IMeshModule.js';
import type { ILogger } from './ILogger.js';
import type { IServiceModule } from './IServiceModule.js';
import type { IProviderToken } from './IProviderToken.js';
import type { IServiceRegistry } from './IServiceRegistry.js';
import type { IMeshMeta } from './IMeshMeta.js';
import type { ICallOptions } from './IServiceContext.js';
import { IMeshPacket } from './IMeshNetwork.js';
export interface AppConfig extends Record<string, unknown> {
    nodeID: string;
    namespace?: string;
    logger?: ILogger;
}

/**
 * IMeshNode — Base interface for a node in the mesh.
 */
export interface IMeshNode {
    readonly nodeID: string;
    readonly namespace: string;
    readonly logger: ILogger;
    readonly registry: IServiceRegistry;
    getConfig?(): Record<string, unknown>;
    publish<K extends keyof EventRegistry>(event: K, payload: EventRegistry[K], options?: { skipNetwork?: boolean }): void;
}

/**
 * IMeshApp — Core container for the mesh application.
 */
export interface IMeshApp extends IMeshNode {
    readonly nodeID: string;
    config: AppConfig;
    logger: ILogger;

    /** Registers a module or middleware. */
    use(moduleOrMiddleware: IMeshModule | ((ctx: any, next: () => Promise<unknown>) => Promise<unknown>)): this;

    /** Registers a service module. */
    registerModule(module: IServiceModule): Promise<this>;

    /** Registers a provider for DI. */
    registerProvider<T>(token: IProviderToken<T>, provider: T): void;

    /** Checks if a provider exists. */
    hasProvider<T>(token: IProviderToken<T>): boolean;

    /** Gets a provider from DI. */
    getProvider<T>(token: IProviderToken<T>): T;

    /** Starts the application. */
    start(): Promise<void>;

    /** Stops the application. */
    stop(): Promise<void>;

    call<K extends keyof IServiceToolRegistry>(
        tool: K,
        params: IServiceToolRegistry[K]['params'],
        options?: ICallOptions<IMeshMeta>
    ): Promise<IServiceToolRegistry[K]['returns']>
    /** Typed event emit. */
    emit<K extends keyof EventRegistry>(event: K, payload: EventRegistry[K], options?: { skipNetwork?: boolean }): void;

    on<K extends keyof EventRegistry>(event: K, handler: (payload: EventRegistry[K], packet?: IMeshPacket<EventRegistry[K]>) => void): (() => void);
    off<K extends keyof EventRegistry>(event: K, handler: (payload: EventRegistry[K], packet?: IMeshPacket<EventRegistry[K]>) => void): void;

}
