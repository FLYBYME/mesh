/**
 * **A Map or Set that keeps only its newest entries.**
 *
 * The network layer keeps small records per node id or address it has met: when it last asked a
 * peer for presence, last dialed it, what node an address turned out to be, which refusal it has
 * already logged. Each was a plain Map or Set that was only ever added to, and the ids and
 * addresses it meets are not a fixed set: every CLI run and every job is a node with a new id, and
 * every new instance of a node has a new address. So a long-lived node held one entry for every
 * peer it had ever met (CHECKLIST 1, "Unbounded maps and timers").
 *
 * Every one of those records is a convenience -- a rate limit, a "said once", a hint -- so
 * forgetting the oldest is always safe: at worst a retry comes sooner or a line is logged again.
 * Oldest by last write: setting a key again moves it to the newest end.
 */
export class BoundedMap<K, V> extends Map<K, V> {
    constructor(private readonly limit: number) {
        super();
    }

    override set(key: K, value: V): this {
        super.delete(key);
        super.set(key, value);
        while (this.size > this.limit) {
            const oldest = this.keys().next();
            if (oldest.done === true) break;
            super.delete(oldest.value);
        }

        return this;
    }
}

export class BoundedSet<T> extends Set<T> {
    constructor(private readonly limit: number) {
        super();
    }

    override add(value: T): this {
        super.delete(value);
        super.add(value);
        while (this.size > this.limit) {
            const oldest = this.values().next();
            if (oldest.done === true) break;
            super.delete(oldest.value);
        }

        return this;
    }
}

/** How many peers' records a node keeps: far more than a mesh has nodes, far less than it meets. */
export const PEER_RECORDS_LIMIT = 4096;
