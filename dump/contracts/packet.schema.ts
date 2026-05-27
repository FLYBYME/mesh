import { z } from 'zod';

/**
 * MeshPacketSchema — The single source of truth for all wire communication.
 */
export const MeshPacketSchema = z.object({
    id: z.string(),
    type: z.enum(['REQUEST', 'RESPONSE', 'RESPONSE_ERROR', 'EVENT', 'AUTH', 'PING', 'STREAM_OPEN', 'STREAM_DATA', 'STREAM_ACK', 'STREAM_CLOSE', 'STREAM_ERROR']),
    topic: z.string().optional(),
    data: z.unknown().optional(),
    senderNodeID: z.string().optional(),
    timestamp: z.number().optional(),
    version: z.number().optional(),
    streamID: z.string().optional(),
    error: z.object({
        message: z.string(),
        code: z.union([z.string(), z.number()]).optional(),
        data: z.unknown().optional()
    }).optional(),
    meta: z.object({
        tenantId: z.string().optional(),
        correlationId: z.string().optional(),
        // Advanced Routing Fields
        ttl: z.number().default(5),
        path: z.array(z.string()).default([]),
        finalDestinationID: z.string().optional(),
        // Tracing Fields
        traceId: z.string().optional(),
        spanId: z.string().optional(),
        parentId: z.string().optional(),
        compression: z.string().optional(),
    }).default({
        ttl: 5,
        path: []
    }),
});

export type IMeshPacket = z.infer<typeof MeshPacketSchema>;

/**
 * TelemetryPacketSchema — Specialized schema for log draining and metrics export.
 */
export const TelemetryPacketSchema = z.object({
    id: z.string(),
    nodeID: z.string(),
    timestamp: z.number(),
    type: z.enum(['log', 'metric', 'log_batch']),
    payload: z.discriminatedUnion('type', [
        z.object({
            type: z.literal('log'),
            level: z.enum(['debug', 'info', 'warn', 'error']),
            message: z.string(),
            data: z.record(z.string(), z.unknown()).optional(),
            traceId: z.string().optional(),
            spanId: z.string().optional(),
        }),
        z.object({
            type: z.literal('log_batch'),
            entries: z.array(z.object({
                level: z.enum(['debug', 'info', 'warn', 'error']),
                message: z.string(),
                data: z.record(z.string(), z.unknown()).optional(),
                context: z.record(z.string(), z.unknown()).optional(),
                nodeID: z.string().optional(),
                traceId: z.string().optional(),
                spanId: z.string().optional(),
                timestamp: z.number()
            }))
        }),
        z.object({
            type: z.literal('metric'),
            name: z.string(),
            metricType: z.enum(['counter', 'gauge', 'histogram']),
            value: z.number(),
            labels: z.record(z.string(), z.string()).optional(),
        })
    ]),
});

export type TelemetryPacket = z.infer<typeof TelemetryPacketSchema>;
