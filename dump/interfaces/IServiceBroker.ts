import type { IMeshNetwork, IMeshPacket  } from './IMeshNetwork';
import type { ILogger  } from './ILogger';
import type { IServiceRegistry  } from './IServiceRegistry';
import type { IServiceModule  } from '../services/ServiceModule';
import type { IContext  } from './IContext';
import type { IMeshMeta  } from './IMeshMeta';
import type { IServiceActionRegistry, IServiceEventRegistry, ISettingsRegistry  } from './IGlobalRegistry';
import type { IBrokerPlugin  } from './IBrokerPlugin';
import type { IMeshApp  } from './IMeshApp';
import type { IMiddleware  } from './IInterceptor';

/**
 * IServiceBroker — Interface for the central communication kernel.
 * Refactored for Bipartite Pipeline and High-Speed execution.
 */
export interface IServiceBroker {
    readonly app: IMeshApp;
    readonly logger: ILogger;
    readonly registry: IServiceRegistry;
    readonly network: IMeshNetwork;

    /** Registers a plugin into the broker's lifecycle. */
    pipe(plugin: IBrokerPlugin): this;

    /** Registers a middleware in the GLOBAL pipeline (Always runs). */
    use(mw: IMiddleware): void;

    /** Registers a middleware in the LOCAL pipeline (Runs only for local services). */
    useLocal(mw: IMiddleware): void;

    /** Registers a service module. */
    registerModule(module: IServiceModule): Promise<void>;

    /** Fully processes a context through the pipeline. */
    handlePipeline(ctx: IContext<Record<string, unknown>, IMeshMeta>): Promise<unknown>;

    /** Low-level execution (used by NetworkPlugin for inbound requests) */
    handleIncomingRPC(packet: IMeshPacket): Promise<unknown>;

    /** Low-level dispatch to remote node. */
    executeRemote(nodeID: string, actionName: string, params: unknown, meta?: Record<string, unknown>): Promise<unknown>;

    /** Typed mesh action call. */
    call<K extends keyof IServiceActionRegistry>(
        action: K,
        params: IServiceActionRegistry[K] extends { params: import('zod').ZodType<infer P> } ? P : Record<string, unknown>,
        options?: { nodeID?: string; timeout?: number }
    ): Promise<IServiceActionRegistry[K] extends { returns: import('zod').ZodType<infer R> } ? R : unknown>;

    // Keep the generic fallback for unregistered actions
    call<TResult = unknown>(
        action: string,
        params: unknown,
        options?: { nodeID?: string; timeout?: number }
    ): Promise<TResult>;

    /** Typed mesh event emit. */
    emit<K extends keyof IServiceEventRegistry>(event: K, payload: unknown, options?: { skipNetwork?: boolean }): void;

    /** Untyped event emit. */
    emit(event: string, payload: unknown, options?: { skipNetwork?: boolean }): void;

    /** Typed settings retrieval. */
    getSetting<K extends keyof ISettingsRegistry>(key: K): ISettingsRegistry[K];
    getSetting<T = unknown>(key: string): T;

    /** Subscription to events. */
    on<T = unknown>(topic: string, handler: (payload: T, packet?: IMeshPacket<T>) => void): (() => void);
    off<T = unknown>(topic: string, handler: (payload: T, packet?: IMeshPacket<T>) => void): void;

    /** Gets the current execution context. */
    getContext(): IContext<Record<string, unknown>, IMeshMeta> | undefined;

    /** Starts the broker and its plugins. */
    start(): Promise<void>;

    /** Stops the broker. */
    stop(): Promise<void>;

    /** Manual wiring (called by plugins) */
    setNetwork(network: IMeshNetwork): void;
    setRegistry(registry: IServiceRegistry): void;
}
