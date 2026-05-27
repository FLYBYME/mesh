import { z } from 'zod';

/**
 * EventDefinition: Binds a unique event name to a specific Zod schema.
 */
export interface EventDefinition<T extends z.ZodTypeAny> {
    readonly name: string;
    readonly schema: T;
}

/**
 * defineEvent: Utility to create a strictly typed event definition.
 */
export function defineEvent<T extends z.ZodTypeAny>(name: string, schema: T): EventDefinition<T> {
    return { name, schema };
}

/**
 * EventRegistry: A global interface for all events in the system.
 * Services use Module Augmentation to register their specific events here.
 */
export interface EventRegistry {
    // Core Engine Events
    'engine:boot': EngineBoot;
    'engine:shutdown': EngineShutdown;

    // Core Persistence Events
    'data:created': DataCreated;
    'data:updated': DataUpdated;
    'data:deleted': DataDeleted;
}

/**
 * IEventBus: Core interface for the engine's event system.
 * Uses the EventRegistry to enforce strict typing.
 */
export interface IEventBus {
    dispatch<K extends keyof EventRegistry>(
        name: K,
        correlationId: string,
        payload: EventRegistry[K]
    ): Promise<void>;

    subscribe<K extends keyof EventRegistry>(
        name: K,
        handler: (payload: EventRegistry[K], correlationId: string) => void | Promise<void>
    ): () => void;

    /** Wildcard subscription for transport layers */
    subscribeAll(
        listener: (name: string, payload: unknown, correlationId: string) => void
    ): () => void;
}

// ─── Engine Lifecycle Events ────────────────────────────────────────────────

export const EngineBootSchema = z.object({
    timestamp: z.date().describe("When the engine started"),
    version: z.string().describe("Engine version")
});
export type EngineBoot = z.infer<typeof EngineBootSchema>;

export const EngineShutdownSchema = z.object({
    timestamp: z.date().describe("When the engine shutdown"),
    reason: z.string().optional()
});
export type EngineShutdown = z.infer<typeof EngineShutdownSchema>;

// ─── Persistence Events ─────────────────────────────────────────────────────

export const DataCreatedSchema = z.object({
    domain: z.string().describe("The domain namespace"),
    id: z.string().describe("The created document ID"),
    item: z.record(z.string(), z.unknown()).describe("The complete created object")
});
export type DataCreated = z.infer<typeof DataCreatedSchema>;

export const DataUpdatedSchema = z.object({
    domain: z.string().describe("The domain namespace"),
    id: z.string().describe("The updated document ID"),
    patch: z.record(z.string(), z.unknown()).describe("The fields that were changed"),
    item: z.record(z.string(), z.unknown()).describe("The complete updated object")
});
export type DataUpdated = z.infer<typeof DataUpdatedSchema>;

export const DataDeletedSchema = z.object({
    domain: z.string().describe("The domain namespace"),
    id: z.string().describe("The deleted document ID")
});
export type DataDeleted = z.infer<typeof DataDeletedSchema>;
