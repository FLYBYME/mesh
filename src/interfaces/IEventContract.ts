import { z } from 'zod';

// ─── Event Definition ────────────────────────────────────────────────────────

/**
 * EventDefinition: Binds a unique event name to a specific Zod schema.
 * Used by `defineEvent()` to declare typed events in contract files.
 */
export interface EventDefinition<T extends z.ZodTypeAny> {
    readonly name: string;
    readonly schema: T;
    readonly scopedBy?: string;
}

export interface EventOptions {
    readonly scopedBy?: string;
}

function unwrapZodType(type: z.ZodTypeAny): z.ZodTypeAny {
    let curr: z.ZodTypeAny = type;
    while (curr) {
        if (curr instanceof z.ZodEffects) {
            curr = curr.innerType();
        } else if (curr instanceof z.ZodOptional || curr instanceof z.ZodNullable) {
            curr = curr.unwrap();
        } else if (curr instanceof z.ZodDefault) {
            curr = curr._def.innerType;
        } else if (curr instanceof z.ZodCatch) {
            curr = curr._def.innerType;
        } else if (curr instanceof z.ZodReadonly) {
            curr = curr._def.innerType;
        } else if (curr instanceof z.ZodLazy) {
            curr = curr._def.getter();
        } else if (curr instanceof z.ZodPipeline) {
            curr = curr._def.in;
        } else {
            break;
        }
    }
    return curr;
}

function getFieldFromZod(type: z.ZodTypeAny, segment: string): z.ZodTypeAny | undefined {
    const unwrapped = unwrapZodType(type);
    if (unwrapped instanceof z.ZodObject) {
        const shape = unwrapped.shape;
        if (segment in shape) {
            return shape[segment];
        }
    } else if (unwrapped instanceof z.ZodIntersection) {
        const left = getFieldFromZod(unwrapped._def.left, segment);
        if (left) return left;
        return getFieldFromZod(unwrapped._def.right, segment);
    } else if (unwrapped instanceof z.ZodUnion) {
        const options: readonly z.ZodTypeAny[] = unwrapped._def.options;
        for (const opt of options) {
            const res = getFieldFromZod(opt, segment);
            if (!res) return undefined;
        }
        return getFieldFromZod(options[0], segment);
    } else if (unwrapped instanceof z.ZodDiscriminatedUnion) {
        const options: readonly z.ZodTypeAny[] = Array.isArray(unwrapped._def.options)
            ? unwrapped._def.options
            : Array.from(unwrapped._def.options.values());
        for (const opt of options) {
            const res = getFieldFromZod(opt, segment);
            if (!res) return undefined;
        }
        return getFieldFromZod(options[0], segment);
    }
    return undefined;
}

function validateEventScope(name: string, schema: z.ZodTypeAny, scopedBy: string): void {
    const segments = scopedBy.split('.');
    let current: z.ZodTypeAny = schema;
    for (const segment of segments) {
        const next = getFieldFromZod(current, segment);
        if (!next) {
            throw new Error(
                `defineEvent Error: The scopedBy field "${scopedBy}" must be defined in the Zod schema for event "${name}". Scoped events require a field in their schema to identify the recipient scope.`
            );
        }
        current = next;
    }
}

/**
 * defineEvent: Utility to create a strictly typed event definition.
 * Automatically registers the event definition in the globalEventRegistry.
 * Events declared with this function are discovered by the generator.
 */
export function defineEvent<T extends z.ZodTypeAny>(
    name: string,
    schema: T,
    options?: EventOptions
): EventDefinition<T> {
    const scopedBy = options?.scopedBy;
    if (scopedBy !== undefined) {
        if (typeof scopedBy !== 'string' || scopedBy.trim().length === 0) {
            throw new Error(`defineEvent Error: scopedBy option for event "${name}" must be a non-empty string.`);
        }
        if (scopedBy.split('.').some(s => s.trim().length === 0)) {
            throw new Error(`defineEvent Error: scopedBy path "${scopedBy}" for event "${name}" contains empty segments.`);
        }
        if (scopedBy !== 'global') {
            validateEventScope(name, schema, scopedBy);
        }
    }
    const def: EventDefinition<T> = scopedBy !== undefined ? { name, schema, scopedBy } : { name, schema };
    globalEventRegistry.register(def);
    return def;
}

// ─── Event Contract Registry ─────────────────────────────────────────────────

/**
 * EventContractRegistry: A typed map of all registered event definitions.
 * Populated at import time by defineEvent. Consumed by:
 *   - API (resolving an event name into its payload schema and scoping rule)
 *   - Generator (static event discovery)
 */
export class EventContractRegistry {
    private readonly events = new Map<string, EventDefinition<z.ZodTypeAny>>();
    /**
     * Definitions peers advertised (presence), for events no module on this node defines -- kept
     * per advertising node, so a node's latest presence replaces what it said before.
     */
    private readonly advertised = new Map<string, Map<string, { readonly scopedBy?: string }>>();

    /**
     * Records one peer's definition of an event, for resolving its scope here without its code.
     *
     * A local definition always outranks any advertisement (`eventScope` reads it first). Between
     * *different* peers that disagree, the stricter answer is used -- no scope (delivered to nobody)
     * over a field over `'global'` -- so a mistaken or stale peer can narrow who receives an event
     * but never widen it. The *same* peer's newer answer replaces its older one: kept as "the
     * strictest ever heard", a node that gained a scope in a redeploy stayed unscoped on every
     * gateway until the gateway restarted (surfdns-compute's volume events, 2026-09-26).
     * Returns false when another peer's stricter answer still decides.
     */
    public advertise(name: string, scopedBy: string | undefined, from = 'unknown'): boolean {
        let byNode = this.advertised.get(name);
        if (byNode === undefined) {
            byNode = new Map();
            this.advertised.set(name, byNode);
        }
        byNode.set(from, scopedBy === undefined ? {} : { scopedBy });
        return this.getAdvertised(name)?.scopedBy === scopedBy;
    }

    /** Replaces everything `from` advertised with `entries` -- one peer's presence, in full. */
    public advertiseAll(from: string, entries: ReadonlyArray<{ name: string; scopedBy?: string }>): string[] {
        for (const byNode of this.advertised.values()) byNode.delete(from);
        const disagreements: string[] = [];
        for (const e of entries) if (!this.advertise(e.name, e.scopedBy, from)) disagreements.push(e.name);
        for (const [name, byNode] of this.advertised) if (byNode.size === 0) this.advertised.delete(name);
        return disagreements;
    }

    public getAdvertised(name: string): { readonly scopedBy?: string } | undefined {
        const byNode = this.advertised.get(name);
        if (byNode === undefined || byNode.size === 0) return undefined;
        const strictness = (scope: string | undefined): number => (scope === undefined ? 2 : scope === 'global' ? 0 : 1);
        let strictest: { readonly scopedBy?: string } | undefined;
        for (const answer of byNode.values()) {
            if (strictest === undefined || strictness(answer.scopedBy) > strictness(strictest.scopedBy)) strictest = answer;
        }
        return strictest;
    }

    /** This node's own definitions, as it advertises them to peers. */
    public advertisable(): Array<{ name: string; scopedBy?: string }> {
        return [...this.events.values()].map((event) =>
            event.scopedBy === undefined ? { name: event.name } : { name: event.name, scopedBy: event.scopedBy });
    }

    public register<T extends z.ZodTypeAny>(event: EventDefinition<T>): void {
        if (this.events.has(event.name)) {
            return;
        }
        this.events.set(event.name, event);
    }

    public has(name: string): boolean {
        return this.events.has(name);
    }

    public clear(): void {
        this.events.clear();
    }

    public get(name: string): EventDefinition<z.ZodTypeAny> | undefined {
        return this.events.get(name);
    }

    public entries(): IterableIterator<[string, EventDefinition<z.ZodTypeAny>]> {
        return this.events.entries();
    }

    public values(): IterableIterator<EventDefinition<z.ZodTypeAny>> {
        return this.events.values();
    }

    public get size(): number {
        return this.events.size;
    }

    /** Every event belonging to one domain (events starting with `${domain}.`). */
    public byDomain(domain: string): Array<EventDefinition<z.ZodTypeAny>> {
        const prefix = `${domain}.`;
        return [...this.events.values()].filter(e => e.name.startsWith(prefix));
    }
}

const globalEventKey = 'mesh.globalEventRegistry';
interface GlobalWithEventRegistry {
    [globalEventKey]?: EventContractRegistry;
}
const globalObj = globalThis as GlobalWithEventRegistry;
if (!globalObj[globalEventKey]) {
    globalObj[globalEventKey] = new EventContractRegistry();
}
export const globalEventRegistry = globalObj[globalEventKey] as EventContractRegistry;



// ─── Event Registry ──────────────────────────────────────────────────────────

declare global {
    interface EventRegistry {
        // Core lifecycle events
        'mesh.started': MeshStarted;
        'mesh.stopped': MeshStopped;

        // Core persistence events
        'data.created': DataCreated;
        'data.updated': DataUpdated;
        'data.deleted': DataDeleted;
    }
}

// ─── Event Bus ───────────────────────────────────────────────────────────────

/**
 * IEventBus: Core interface for the mesh event system.
 * Uses EventRegistry to enforce 100% strict typing.
 */
export interface IEventBus {
    dispatch<K extends keyof EventRegistry>(
        name: K,
        payload: EventRegistry[K]
    ): void;

    subscribe<K extends keyof EventRegistry>(
        name: K,
        handler: (payload: EventRegistry[K]) => void | Promise<void>
    ): () => void;

    /** Wildcard subscription for transport layers. */
    subscribeAll(
        listener: (name: string, payload: unknown) => void
    ): () => void;
}

// ─── Core Event Schemas ──────────────────────────────────────────────────────

export const MeshStartedSchema = z.object({
    timestamp: z.date().describe('When the mesh node started'),
    nodeID: z.string().describe('Node ID that started')
});
export type MeshStarted = z.infer<typeof MeshStartedSchema>;

export const MeshStoppedSchema = z.object({
    timestamp: z.date().describe('When the mesh node stopped'),
    nodeID: z.string().describe('Node ID that stopped'),
    reason: z.string().optional()
});
export type MeshStopped = z.infer<typeof MeshStoppedSchema>;

export const DataCreatedSchema = z.object({
    domain: z.string().describe('The domain namespace'),
    id: z.string().describe('The created document ID'),
    item: z.record(z.string(), z.unknown()).describe('The complete created object')
});
export type DataCreated = z.infer<typeof DataCreatedSchema>;

export const DataUpdatedSchema = z.object({
    domain: z.string().describe('The domain namespace'),
    id: z.string().describe('The updated document ID'),
    patch: z.record(z.string(), z.unknown()).describe('The fields that were changed'),
    item: z.record(z.string(), z.unknown()).describe('The complete updated object')
});
export type DataUpdated = z.infer<typeof DataUpdatedSchema>;

export const DataDeletedSchema = z.object({
    domain: z.string().describe('The domain namespace'),
    id: z.string().describe('The deleted document ID')
});
export type DataDeleted = z.infer<typeof DataDeletedSchema>;

export type { EventRegistry };
