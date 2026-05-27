import type { TimerHandle } from '../interfaces/ITimer.js';

/**
 * SafeTimer — Provides isomorphic-safe timer management.
 * Handles the difference between Node.js Timeout objects and Browser timer numbers.
 */
export class SafeTimer {
    /**
     * Safely unrefs a timer if running in Node.js, doing nothing in the browser.
     * This prevents background timers from blocking the Node.js event loop exit.
     */
    static unref(timer: TimerHandle | undefined): void {
        if (timer && typeof timer === 'object' && 'unref' in timer) {
            (timer as { unref: () => void }).unref();
        }
    }

    /**
     * Safely clears an interval whether it's a Node Timeout or a Browser number.
     */
    static clearInterval(timer: TimerHandle | undefined): void {
        if (timer) {
            clearInterval(timer as any);
        }
    }

    /**
     * Safely clears a timeout whether it's a Node Timeout or a Browser number.
     */
    static clearTimeout(timer: TimerHandle | undefined): void {
        if (timer) {
            clearTimeout(timer as any);
        }
    }
}
