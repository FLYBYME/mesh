import { z } from 'zod';

// ─── Event Definition ────────────────────────────────────────────────────────

/**
 * EventDefinition: Binds a unique event name to a specific Zod schema.
 * Used by `defineEvent()` to declare typed events in contract files.
 */
export interface EventDefinition<T extends z.ZodTypeAny> {
    readonly name: string;
    readonly schema: T;
}

/**
 * defineEvent: Utility to create a strictly typed event definition.
 * Events declared with this function are discovered by the generator.
 */
export function defineEvent<T extends z.ZodTypeAny>(name: string, schema: T): EventDefinition<T> {
    return { name, schema };
}

// ─── Event Registry ──────────────────────────────────────────────────────────

/**
 * EventRegistry: A global interface for all events in the mesh.
 * Services use Module Augmentation to register their specific events here.
 * The code generator also augments this interface from `defineEvent()` calls.
 *
 * Mandate: No index signatures. All keys must be explicitly added via augmentation.
 */
 
export interface EventRegistry {
    // Core lifecycle events
    'mesh.started': MeshStarted;
    'mesh.stopped': MeshStopped;

    // Core persistence events
    'data.created': DataCreated;
    'data.updated': DataUpdated;
    'data.deleted': DataDeleted;
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
