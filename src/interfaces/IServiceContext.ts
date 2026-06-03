import type { ILogger } from './ILogger.js';
import type { IServiceBroker } from './IServiceBroker.js';

/**
 * Global Registry Declarations:
 * We use a global namespace so that multiple physical copies of the @flybyme/mesh package
 * (common in multi-repo/multi-package environments) can all contribute to the same
 * strictly-typed registries.
 */
declare global {
    /**
     * IServiceToolRegistry: The global registry mapping tool keys to their parameter and return types.
     * Populated by generated code.
     */
    interface IServiceToolRegistry {
        // Generated tools will appear here like:
        // 'demo.hello': { params: z.infer<...>, returns: z.infer<...> }
    }

    /**
     * EventRegistry: The global registry for strictly-typed events.
     * Populated by generated code.
     */
    interface EventRegistry {
        // Generated events will appear here like:
        // 'demo.hello.sent': { ... }
    }
}

/**
 * IServiceContext: The strictly-typed execution context injected into every tool handler.
 */
export interface IServiceContext {
    /** The service broker instance handling this execution context. */
    readonly broker: IServiceBroker;

    /** Unique correlation ID for distributed tracing. */
    readonly correlationId: string;

    /** The node ID this context is executing on. */
    readonly nodeID: string;

    /** Optional abort signal for cancellation. */
    readonly signal?: AbortSignal;

    /** Strictly typed tool call. */
    call<K extends keyof IServiceToolRegistry>(
        tool: K,
        params: IServiceToolRegistry[K]['params'],
        options?: { nodeID?: string; timeout?: number }
    ): Promise<IServiceToolRegistry[K]['returns']>;

    /** Strictly typed event dispatch. */
    emit<K extends keyof EventRegistry>(
        event: K,
        payload: EventRegistry[K],
        options?: { skipNetwork?: boolean }
    ): void;

    logger: ILogger;
}

/**
 * ServiceActionHandler: The function signature for a tool's implementation.
 */
export type ServiceActionHandler<TInput, TOutput> = (
    args: TInput,
    context: IServiceContext
) => Promise<TOutput>;

export type { IServiceToolRegistry };
