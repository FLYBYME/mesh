import type { EventRegistry } from './IEventContract.js';
import { ILogger } from './ILogger.js';
import type { IServiceBroker } from './IServiceBroker.js';

/**
 * IServiceToolRegistry: The global registry mapping tool keys to their parameter and return types.
 * Populated by generated code.
 */

export interface IServiceToolRegistry {
    // Generated tools will appear here like:
    // 'demo.hello': { params: z.infer<...>, returns: z.infer<...> }
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
