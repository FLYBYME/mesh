/**
 * A stop that waits for what it stops.
 *
 * A `long-running` contract hands its teardown to `ctx.signal`, and an abort listener runs and
 * returns at once: whatever it starts -- a server's `close()`, a port being let go -- finishes later,
 * with nobody waiting. So "unregistered" meant "asked to close", and a part reloaded at once found
 * its own old copy still on the port (11-05: an SSH door reloaded onto its own terminal port, got
 * EADDRINUSE, and the node it ran on went down with it).
 *
 * `onStop(ctx.signal, close)` is the abort listener that is waited for: the broker, having aborted a
 * registration's signal, waits for every `close` handed to it (up to `STOP_WAIT_MS`) before
 * `unregisterContract`, `unregisterOwner` or `stop` resolve. A plain abort listener still works as
 * it always has, unwaited.
 */

/** How long a stop waits for its closes: past it, the stop resolves and says what was still closing. */
export const STOP_WAIT_MS = 10_000;

const closing = new WeakMap<AbortSignal, Array<Promise<void>>>();

/**
 * Runs `close` when `signal` aborts -- at once when it already has -- and has the stop that aborted
 * it wait for `close` to finish. A `close` that throws or rejects is reported by the stop, never
 * thrown into the abort.
 */
export function onStop(signal: AbortSignal, close: () => void | Promise<void>): void {
    const run = (): void => {
        const done = Promise.resolve().then(close).then(() => undefined);
        const list = closing.get(signal);

        if (list === undefined) closing.set(signal, [done]);
        else list.push(done);
    };

    if (signal.aborted) {
        run();
        return;
    }

    signal.addEventListener('abort', run, { once: true });
}

/** What waiting for one signal's closes came to. */
export interface StopOutcome {
    readonly closed: number;
    readonly failed: readonly unknown[];
    /** Closes not finished within the wait. */
    readonly stillClosing: number;
}

/**
 * Waits for the closes `onStop` started on `signal` (call it after aborting), up to `withinMs`.
 * Resolves, never rejects: a stop goes on whatever its closes do.
 */
export async function closesOf(signal: AbortSignal, withinMs: number = STOP_WAIT_MS): Promise<StopOutcome> {
    const list = closing.get(signal) ?? [];
    closing.delete(signal);
    if (list.length === 0) return { closed: 0, failed: [], stillClosing: 0 };

    const failed: unknown[] = [];
    let closed = 0;
    const settled = Promise.all(list.map((done) => done.then(() => {
        closed += 1;
    }, (err: unknown) => {
        failed.push(err);
    })));

    let timer: ReturnType<typeof setTimeout> | undefined;
    const outOfTime = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, withinMs);
    });

    await Promise.race([settled, outOfTime]);
    clearTimeout(timer);

    return { closed, failed: [...failed], stillClosing: list.length - closed - failed.length };
}
