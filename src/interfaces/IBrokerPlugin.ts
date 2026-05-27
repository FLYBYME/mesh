import type { IServiceBroker  } from './IServiceBroker.js';

/**
 * IBrokerPlugin — Standard interface for hooking into the ServiceBroker lifecycle.
 * Supports multi-stage bootstrapping to avoid race conditions.
 */
export interface IBrokerPlugin {
    readonly name: string;

    /**
     * Synchronous registration phase.
     * Use this to register intents, middleware, and public APIs.
     */
    onRegister(broker: IServiceBroker): void;

    /**
     * Asynchronous startup phase.
     * Executed when broker.start() is called, after all plugins are registered.
     */
    onStart?(broker: IServiceBroker): Promise<void>;

    /**
     * Asynchronous teardown phase.
     * Executed when broker.stop() is called.
     */
    onStop?(broker: IServiceBroker): Promise<void>;
}
