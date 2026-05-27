import type { IMeshNetwork, IMeshPacket } from './IMeshNetwork.js';
import type { ILogger } from './ILogger.js';
import type { IServiceRegistry } from './IServiceRegistry.js';
import type { IServiceModule } from './IServiceModule.js';
import type { IContext } from './IContext.js';
import type { IMeshMeta } from './IMeshMeta.js';
import type { IBrokerPlugin } from './IBrokerPlugin.js';
import type { IMiddleware } from './IInterceptor.js';
import type { EventRegistry } from './IEventContract.js';
import type { IServiceToolRegistry } from './IServiceContext.js';

/**
 * IServiceBroker — Interface for the central communication kernel.
 */
export interface IServiceBroker {
    readonly nodeID: string;
    readonly logger: ILogger;
    readonly registry: IServiceRegistry;
    readonly network: IMeshNetwork;

    pipe(plugin: IBrokerPlugin): this;
    use(mw: IMiddleware): void;
    useLocal(mw: IMiddleware): void;
    registerModule(module: IServiceModule): Promise<void>;
    handlePipeline(ctx: IContext<Record<string, unknown>, IMeshMeta>): Promise<unknown>;
    handleIncomingRPC(packet: IMeshPacket): Promise<unknown>;
    executeRemote(nodeID: string, toolName: string, params: unknown, meta?: Record<string, unknown>): Promise<unknown>;

    /** Typed tool call. */
    call<K extends keyof IServiceToolRegistry>(
        tool: K,
        params: IServiceToolRegistry[K] extends { params: infer P } ? P : never,
        options?: { nodeID?: string; timeout?: number }
    ): Promise<IServiceToolRegistry[K] extends { returns: infer R } ? R : unknown>;

    /** Untyped fallback for internal dynamic routing */
    call(tool: string, params: unknown, options?: { nodeID?: string; timeout?: number }): Promise<unknown>;

    /** Typed event emit. */
    emit<K extends keyof EventRegistry>(event: K, payload: EventRegistry[K], options?: { skipNetwork?: boolean }): void;

    on<T = unknown>(topic: string, handler: (payload: T, packet?: IMeshPacket<T>) => void): (() => void);
    off<T = unknown>(topic: string, handler: (payload: T, packet?: IMeshPacket<T>) => void): void;

    getContext(): IContext<Record<string, unknown>, IMeshMeta> | undefined;

    start(): Promise<void>;
    stop(): Promise<void>;

    setNetwork(network: IMeshNetwork): void;
    setRegistry(registry: IServiceRegistry): void;

    registerProvider(name: string, provider: unknown): void;
    getProvider<T>(name: string): T;
}
