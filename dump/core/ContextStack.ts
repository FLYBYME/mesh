import type { IContext } from '../interfaces';

/**
 * Isomorphic Context Tracking.
 * Uses AsyncLocalStorage in Node.js and a simple stack in the Browser.
 */
export class ContextStack {
    private static storage: import('node:async_hooks').AsyncLocalStorage<IContext> | undefined;

    static {
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { AsyncLocalStorage } = require('node:async_hooks');
            if (AsyncLocalStorage) {
                this.storage = new AsyncLocalStorage();
            }
        } catch {
            // Browser environment
        }
    }

    /**
     * Executes a function within a context.
     * Supports both synchronous and asynchronous functions.
     */
    public static run<T>(ctx: IContext, fn: () => T): T {
        if (this.storage) {
            return this.storage.run(ctx, fn);
        }

        // In the browser, we rely strictly on explicit ctx.call() closures.
        // There is no global tracking.
        return fn();
    }

    /**
     * Retrieves the current context.
     */
    public static getContext(): IContext | undefined {
        if (this.storage) {
            return this.storage.getStore();
        }
        return undefined;
    }
}
