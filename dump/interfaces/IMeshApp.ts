import type { IMeshModule  } from './IMeshModule';
import type { ILogger  } from './ILogger';
import type { IServiceModule  } from '../services/ServiceModule';
import type { IProviderToken  } from './IProviderToken';

import type { IServiceRegistry  } from './IServiceRegistry';
import type { IServiceActionRegistry  } from './IGlobalRegistry';

export interface AppConfig extends Record<string, unknown> {
    nodeID: string;
    namespace?: string | undefined;
    logger?: ILogger | undefined;
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
    orchestrator?: unknown | undefined;
}

/**
 * IMeshApp — Core container for the mesh application.
 */
export interface IMeshApp extends IMeshNode {
    readonly nodeID: string;
    config: AppConfig;
    logger: ILogger;

    /** Registers a module or middleware. */
    use(moduleOrMiddleware: IMeshModule | ((ctx: unknown, next: () => Promise<unknown>) => Promise<unknown>)): this;

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

    call<K extends keyof IServiceActionRegistry>(
        action: K,
        params: IServiceActionRegistry[K] extends { params: import('zod').ZodType<infer P> } ? P : Record<string, unknown>,
        options?: { nodeID?: string; timeout?: number }
    ): Promise<IServiceActionRegistry[K] extends { returns: import('zod').ZodType<infer R> } ? R : unknown>;

    call<TResult = unknown>(action: string, params: unknown, options?: { nodeID?: string; timeout?: number }): Promise<TResult>;
}
