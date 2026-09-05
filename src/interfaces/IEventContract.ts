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
    return scopedBy !== undefined ? { name, schema, scopedBy } : { name, schema };
}

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
