import { z } from 'zod';

/**
 * ToolInfoSchema
 * Metadata about a service tool shared across the mesh.
 */
export const ToolInfoSchema = z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    visibility: z.enum(['public', 'user', 'internal', 'published', 'protected', 'private']).optional(),
    params: z.record(z.unknown()).optional(),
    returns: z.record(z.unknown()).optional(),
    rest: z.record(z.unknown()).optional(),
    roles: z.array(z.string()).optional(),
    matchAny: z.boolean().optional(),
    highSecurity: z.boolean().optional(),
    metadata: z.record(z.unknown()).optional(),
    timeout: z.number().optional(),
    /** contractHash: changes when the contract or its handler does -- two nodes serving one name differently. */
    hash: z.string().optional(),
});

export type ToolInfo = z.infer<typeof ToolInfoSchema>;

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
    tools: z.record(ToolInfoSchema).optional(),
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
    bootedAt: z.number().optional(),
    /** What software the node runs, by package: `{ 'mesh-serve': 'v0.10.34', mesh: '4.10.12' }`. */
    software: z.record(z.string()).optional(),

    // Telemetry / Health
    cpu: z.number().optional(),
    activeRequests: z.number().optional(),
    healthScore: z.number().optional(),

    cachedBigIntID: z.string().optional(), // Internal optimization
});

export type NodeInfo = z.infer<typeof NodeInfoSchema>;
