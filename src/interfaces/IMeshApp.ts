import type { IMeshModule } from './IMeshModule.js';
import type { ILogger } from './ILogger.js';
import type { IServiceModule } from './IServiceModule.js';
import type { IProviderToken } from './IProviderToken.js';
import type { IServiceRegistry } from './IServiceRegistry.js';
import type { IServiceToolRegistry } from './IServiceContext.js';

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
    publish<T = unknown>(topic: string, data: T): Promise<void>;
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
        action: K,
        params: IServiceToolRegistry[K] extends { params: infer P } ? P : Record<string, unknown>,
        options?: { nodeID?: string; timeout?: number }
    ): Promise<IServiceToolRegistry[K] extends { returns: infer R } ? R : unknown>;

    call<TResult = unknown>(action: string, params: unknown, options?: { nodeID?: string; timeout?: number }): Promise<TResult>;
}
