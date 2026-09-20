import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Tracks which tools are being placed *on the current async call stack*.
 *
 * `ServiceBroker.ensurePlaced` has to tell two situations apart that look identical from a plain
 * `Set`:
 *
 * - **Concurrent**: twenty callers want a tool nothing serves. Nineteen should wait for the one
 *   placement in flight.
 * - **Re-entrant**: a placement provider, while placing `X`, makes a call that needs `X`. Waiting
 *   here would be waiting on ourselves, so that inner call must proceed unplaced and fail.
 *
 * The difference is not timing, it is *lineage* -- which is exactly what `AsyncLocalStorage`
 * tracks, and why a shared flag cannot express it. Same reasoning as `ContextStack`, which already
 * relies on it for the same reason.
 *
 * Without `AsyncLocalStorage` (a browser bundle whose bundler did not alias `node:async_hooks`)
 * this degrades to a module-level set: re-entrancy is still refused, but a concurrent caller is
 * treated as re-entrant and fails instead of waiting. That is the safe direction, and placement is
 * a server-side concern anyway -- a browser never loads parts, so it never installs a provider.
 */
export class PlacementScope {
    private static readonly storage: AsyncLocalStorage<Set<string>> | undefined =
        typeof AsyncLocalStorage === 'function' ? new AsyncLocalStorage<Set<string>>() : undefined;

    /** Used only when AsyncLocalStorage is unavailable -- see the class note. */
    private static readonly fallback = new Set<string>();

    /**
     * Runs `fn` with `toolName` marked as in-progress for everything it transitively calls.
     *
     * A fresh set per scope rather than mutate-and-restore: the scope is entered synchronously
     * when this is called, so a provider's own synchronous prelude is already inside it.
     */
    public static run<T>(toolName: string, fn: () => Promise<T>): Promise<T> {
        if (this.storage === undefined) {
            this.fallback.add(toolName);
            return fn().finally(() => { this.fallback.delete(toolName); });
        }

        const nested = new Set(this.storage.getStore() ?? []);
        nested.add(toolName);
        return this.storage.run(nested, fn);
    }

    public static isPlacing(toolName: string): boolean {
        if (this.storage === undefined) return this.fallback.has(toolName);
        return this.storage.getStore()?.has(toolName) ?? false;
    }
}
