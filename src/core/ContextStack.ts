import type { IContext } from '../interfaces/IContext.js';

/**
 * Isomorphic Context Tracking.
 * Uses AsyncLocalStorage in Node.js and a simple stack in the Browser.
 *
 * ## Why this is not a `require` in a static block any more
 *
 * It used to be:
 *
 *     static {
 *         try {
 *             const { AsyncLocalStorage } = require('node:async_hooks');
 *             ...
 *         } catch {
 *             // Browser environment
 *         }
 *     }
 *
 * This package publishes ESM (`"type": "module"`), and `require` is not defined in an ES module.
 * So in every real Node process the call threw, the catch labelled "Browser environment" swallowed
 * it, and `storage` stayed `undefined` -- meaning **there was no context tracking at all**.
 * `run()` fell through to calling `fn()` and `getContext()` always returned `undefined`.
 *
 * The consequence was not a crash. `ServiceBroker.internalCall` builds a nested call's context as
 * `{ ...activeCtx?.meta, ...options?.meta }`, so with no active context every nested `ctx.call`
 * silently started from nothing: the caller's identity gone, `correlationID` regenerated, and the
 * trace broken at the first hop. A handler could read `ctx.meta.user` and the collection it then
 * called could not.
 *
 * It was invisible to this repo's own tests because ts-jest transpiles to CommonJS, where `require`
 * exists and the storage is created. The bug only existed in the shipped artifact. See
 * `ContextStackEsm.spec.ts`, which runs the built ESM output in a real node process for exactly
 * that reason.
 *
 * A static import is the fix. Bundlers targeting the browser resolve `node:async_hooks` through
 * their own polyfill or alias configuration; `run`/`getContext` still degrade to the explicit-ctx
 * path if it resolves to something without `AsyncLocalStorage`.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export class ContextStack {
    private static storage: AsyncLocalStorage<IContext> | undefined =
        typeof AsyncLocalStorage === 'function' ? new AsyncLocalStorage<IContext>() : undefined;

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
