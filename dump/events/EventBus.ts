import { EventRegistry, IEventBus } from './events';

/**
 * EventBus: The strictly-typed communication hub for the Mesh Engine.
 */
export class EventBus implements IEventBus {
    private handlers: {
        [K in keyof EventRegistry]?: Set<(payload: EventRegistry[K], correlationId: string) => void | Promise<void>>
    } = {};

    private wildcardListeners: Set<(name: string, payload: unknown, correlationId: string) => void> = new Set();

    public async dispatch<K extends keyof EventRegistry>(
        name: K,
        correlationId: string,
        payload: EventRegistry[K]
    ): Promise<void> {
        const subscribers = this.handlers[name] as Set<(p: EventRegistry[K], c: string) => void | Promise<void>> | undefined;

        if (subscribers) {
            const promises: Promise<void>[] = [];
            for (const handler of subscribers) {
                try {
                    const r = handler(payload, correlationId);
                    if (r instanceof Promise) {
                        promises.push(r.catch(err => console.error(`[EventBus] Async handler error for ${name}:`, String(err))));
                    }
                } catch (err) {
                    console.error(`[EventBus] Sync handler error for ${name}:`, String(err));
                }
            }
            if (promises.length > 0) {
                await Promise.allSettled(promises);
            }
        }

        // Notify wildcard listeners (Transports/Logging)
        for (const listener of this.wildcardListeners) {
            try {
                listener(name as string, payload, correlationId);
            } catch {
                // Ignore wildcard failures
            }
        }
    }

    public subscribe<K extends keyof EventRegistry>(
        name: K,
        handler: (payload: EventRegistry[K], correlationId: string) => void | Promise<void>
    ): () => void {
        if (!this.handlers[name]) {
            const newSet = new Set<(payload: EventRegistry[K], correlationId: string) => void | Promise<void>>();
            const handlers = this.handlers as Record<string, unknown>;
            handlers[name] = newSet;
        }

        const set = this.handlers[name] as Set<(p: EventRegistry[K], c: string) => void | Promise<void>>;
        set.add(handler);

        return () => {
            const currentSet = this.handlers[name] as Set<(p: EventRegistry[K], c: string) => void | Promise<void>> | undefined;
            if (currentSet) {
                currentSet.delete(handler);
                if (currentSet.size === 0) {
                    delete this.handlers[name];
                }
            }
        };
    }

    public subscribeAll(
        listener: (name: string, payload: unknown, correlationId: string) => void
    ): () => void {
        this.wildcardListeners.add(listener);
        return () => this.wildcardListeners.delete(listener);
    }
}
