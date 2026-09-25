/**
 * How many nodes run a handler for one occurrence of its event.
 *
 * - `'each'` -- every node that has the handler registered. For work that is local to a node: a
 *   projection or cache that each node holds for itself (the proxy's route table, a nameserver's
 *   zones).
 * - `'one'` -- one node in the cluster: the leader for the handler's `domain`
 *   (`IServiceRegistry.leaderFor`), the same rule a `leaderScoped` interval contract uses. For work
 *   with an effect outside the node: writing a record, sending mail, calling another service. Run on
 *   every node, that work happens N times.
 *
 * Required, with no default, because the two are wrong in opposite directions and neither is safe
 * to assume: a default of `'each'` duplicates every side effect as the cluster grows, a default of
 * `'one'` silently leaves every node but one with a stale projection.
 */
export type EventHandlerDelivery = 'each' | 'one';

/**
 * A declared event handler: which event, on behalf of which domain, delivered how.
 *
 * The replacement for what `ServiceModule` subclasses used to do by hand in `onStart` -- subscribe,
 * remember the unsubscribe, run it in `onStop`. Registered with `broker.registerEventHandler(def,
 * handler)` beside a part's contracts, and removed with them when the part unloads (see
 * `broker.withOwner`).
 */
export interface EventHandlerDefinition<K extends keyof EventRegistry = keyof EventRegistry> {
    readonly event: K;
    /** The domain this handler works for; `'one'` delivery elects its leader by this domain. */
    readonly domain: string;
    readonly delivery: EventHandlerDelivery;
    readonly description: string;
}

export function defineEventHandler<K extends keyof EventRegistry>(
    definition: EventHandlerDefinition<K>,
): EventHandlerDefinition<K> {
    const event: string = definition.event;
    if (event.trim().length === 0) {
        throw new Error('defineEventHandler Error: event must be a non-empty event name.');
    }
    if (definition.domain.trim().length === 0) {
        throw new Error(`defineEventHandler Error: handler for "${event}" must name the domain it works for.`);
    }
    if (definition.delivery !== 'each' && definition.delivery !== 'one') {
        throw new Error(`defineEventHandler Error: handler for "${event}" must declare delivery 'each' or 'one'.`);
    }
    return Object.freeze({ ...definition });
}
