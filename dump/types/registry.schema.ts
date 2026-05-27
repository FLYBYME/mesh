import { z } from 'zod';

/**
 * ActionInfoSchema
 * Metadata about a service action shared across the mesh.
 */
export const ActionInfoSchema = z.object({
    name: z.string().optional(),
    visibility: z.enum(['public', 'user', 'internal', 'published', 'protected', 'private']).optional(),
    params: z.record(z.unknown()).optional(),
    rest: z.record(z.unknown()).optional(),
    roles: z.array(z.string()).optional(),
    matchAny: z.boolean().optional(),
    highSecurity: z.boolean().optional(),
    metadata: z.record(z.unknown()).optional(),
});

export type ActionInfo = z.infer<typeof ActionInfoSchema>;

/**
 * EventInfoSchema
 * Metadata about a service event.
 */
export const EventInfoSchema = z.object({
    name: z.string().optional(),
    group: z.string().optional(),
});

export type EventInfo = z.infer<typeof EventInfoSchema>;

/**
 * ServiceInfoSchema
 * The summary of a service's capabilities shared during gossip.
 */
export const ServiceInfoSchema = z.object({
    name: z.string(),
    fullName: z.string().optional(),
    version: z.union([z.string(), z.number()]).optional(),
    settingsSchema: z.record(z.unknown()).optional(),
    dependencies: z.array(z.string()).optional(),
    actions: z.record(ActionInfoSchema).optional(),
    events: z.record(EventInfoSchema).optional(),
    metadata: z.record(z.unknown()).optional(),
    rest: z.record(z.unknown()).optional(),
});

export type ServiceInfo = z.infer<typeof ServiceInfoSchema>;

/**
 * NodeInfoSchema
 * The complete record of a mesh node and its hosted services.
 */
export const NodeInfoSchema = z.object({
    nodeID: z.string(),
    type: z.string(),
    nodeType: z.string().optional(),
    trustLevel: z.enum(['internal', 'user', 'public']).default('public'),
    namespace: z.string().default('default'),
    region: z.string().optional(),
    addresses: z.array(z.string()),
    services: z.array(ServiceInfoSchema),
    capabilities: z.record(z.unknown()).default({}),
    resources: z.record(z.unknown()).optional(),
    metadata: z.record(z.unknown()).default({}),
    nodeSeq: z.number(),
    hostname: z.string(),
    pid: z.number().default(0),
    timestamp: z.number(),
    available: z.boolean().default(true),
    lastHeartbeatTime: z.number().optional(),
    parentID: z.string().optional(),
    hidden: z.boolean().optional(),

    // Telemetry / Health
    cpu: z.number().optional(),
    activeRequests: z.number().optional(),
    healthScore: z.number().optional(),

    cachedBigIntID: z.string().optional(), // Internal optimization
});

export type NodeInfo = z.infer<typeof NodeInfoSchema>;
