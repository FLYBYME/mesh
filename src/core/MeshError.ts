import { z } from 'zod';

export const MeshErrorPayloadSchema = z.object({
    code: z.string(),
    message: z.string(),
    status: z.number().default(500),
    data: z.unknown().optional(),
    stack: z.string().optional(),
    correlationId: z.string().optional(),
});

export type MeshErrorPayload = z.infer<typeof MeshErrorPayloadSchema>;

/**
 * Standardized MeshError class.
 * Uses Zod to validate cross-service error payloads.
 */
export class MeshError extends Error {
    public readonly code: string;
    public readonly status: number;
    public readonly data?: unknown;
    public readonly correlationId?: string;

    constructor(payload: MeshErrorPayload | string) {
        const data = typeof payload === 'string' 
            ? { message: payload, code: 'INTERNAL_ERROR', status: 500 } 
            : MeshErrorPayloadSchema.parse(payload);
            
        super(data.message);
        this.name = 'MeshError';
        this.code = data.code;
        this.status = data.status;
        this.data = data.data;
        this.correlationId = data.correlationId;
        if (data.stack) this.stack = data.stack;
    }

    public toJSON(): MeshErrorPayload {
        return {
            code: this.code,
            message: this.message,
            status: this.status,
            data: this.data,
            stack: this.stack,
            correlationId: this.correlationId
        };
    }
}

/**
 * ResiliencyError — Thrown by Circuit Breakers, Rate Limiters, or Retry policies.
 * Maps to 503 (Service Unavailable) or 429 (Too Many Requests).
 */
export class ResiliencyError extends MeshError {
    constructor(message: string, code = 'SERVICE_UNAVAILABLE', status = 503) {
        super({ message, code, status });
        this.name = 'ResiliencyError';
    }
}

/**
 * ClientError — Thrown for user-level validation or permission errors (4xx).
 */
export class ClientError extends MeshError {
    constructor(message: string, code = 'BAD_REQUEST', status = 400) {
        super({ message, code, status });
        this.name = 'ClientError';
    }
}

