import { z } from 'zod';

export const MeshErrorPayloadSchema = z.object({
    code: z.string(),
    message: z.string(),
    status: z.number().default(500),
    data: z.unknown().optional(),
    stack: z.string().optional(),
    correlationId: z.string().optional(),
    /** The node whose handler threw it, kept across every hop back to the caller. */
    nodeID: z.string().optional(),
});

export type MeshErrorPayload = z.infer<typeof MeshErrorPayloadSchema>;

/**
 * A cross-realm brand, because `instanceof` is not reliable here.
 *
 * `Symbol.for` looks up the process-wide registry, so every copy of this module agrees on this
 * symbol even when they are separate module instances -- which they routinely are. A node running
 * under `tsx` loads `@flybyme/mesh` twice, once through the ESM loader for its own imports and once
 * through `require()` when it loads a precompiled `.cjs` part, and those give two distinct
 * `MeshError` classes. Duplicated dependencies and bundled copies do the same thing.
 *
 * The symptom is silent and looks like something else entirely: a handler throws a perfectly good
 * MeshError with status 404, the code that decides the HTTP status checks `instanceof` in the other
 * realm, gets `false`, and answers 500. Verified directly -- under tsx,
 * `require('@flybyme/mesh').MeshError === (await import('@flybyme/mesh')).MeshError` is `false`.
 */
export const MESH_ERROR_BRAND: unique symbol = Symbol.for('@flybyme/mesh.MeshError') as never;

/**
 * Standardized MeshError class.
 * Uses Zod to validate cross-service error payloads.
 */
export class MeshError extends Error {
    /** See {@link MESH_ERROR_BRAND}. Inherited by ResiliencyError/ClientError. */
    public readonly [MESH_ERROR_BRAND] = true as const;
    public readonly code: string;
    public readonly status: number;
    public readonly data?: unknown;
    public readonly correlationId?: string;
    public readonly nodeID?: string;

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
        this.nodeID = data.nodeID;
        if (data.stack) this.stack = data.stack;
    }

    public toJSON(): MeshErrorPayload {
        return {
            code: this.code,
            message: this.message,
            status: this.status,
            data: this.data,
            stack: this.stack,
            correlationId: this.correlationId,
            nodeID: this.nodeID
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
 * A call that ran out of time: 504, its own code, so a caller (the api gateway) can tell it from a
 * handler that failed. It used to be a plain Error, which reached an api caller as a bare 500.
 */
export class TimeoutError extends MeshError {
    constructor(message: string) {
        super({ message, code: 'TIMEOUT', status: 504 });
        this.name = 'TimeoutError';
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


/**
 * Is this a MeshError, including one built by a different copy of this module?
 *
 * Use this rather than `instanceof MeshError` anywhere the error may have come from elsewhere --
 * across the mesh, out of a loaded part, or through a bundle. See {@link MESH_ERROR_BRAND} for why
 * `instanceof` is not enough.
 */
export function isMeshError(err: unknown): err is MeshError {
    return typeof err === 'object'
        && err !== null
        && (err as Record<symbol, unknown>)[MESH_ERROR_BRAND] === true;
}

/**
 * Rebuilds the error a remote handler threw, from whatever crossed the wire.
 *
 * Three places used to do this, each reading a different field and all of them producing a plain
 * `Error`: `WSTransport`, `BrowserWebSocketTransport` and `ServiceBroker`. The consequence was that
 * a `MeshError`'s `code` and `status` never survived a hop -- the same call answered 404 locally
 * and 500 remotely, because an api gateway picks its status with `err instanceof MeshError`.
 *
 * That the transports reconstruct at all is what made it subtle: fixing the broker alone changed
 * nothing over WebSocket, since the transport's own pending-RPC table settles the promise first and
 * the broker's handler never sees the packet.
 *
 * A `MeshError` comes back when the far side sent one -- `code` and `status` together, since
 * neither is meaningful alone. Anything else stays a plain `Error`; it had no status to lose.
 */
export function errorFromWire(payload: unknown, fallbackMessage = 'Remote RPC Error'): Error {
    const field = (key: string): unknown => (typeof payload === 'object' && payload !== null ? Reflect.get(payload, key) : undefined);
    const text = (key: string): string | undefined => {
        const value = field(key);
        return typeof value === 'string' && value.length > 0 ? value : undefined;
    };

    const message = text('message') ?? fallbackMessage;
    const code = text('code');
    const status = field('status');
    const nodeID = text('nodeID');
    const correlationId = text('correlationId');
    const data = field('data');
    // A plain error's stack travels as `data: { stack }`; that is not data the handler meant to send.
    const stackOnly = typeof data === 'object' && data !== null && Object.keys(data).every((k) => k === 'stack');
    const dataStack: unknown = typeof data === 'object' && data !== null ? Reflect.get(data, 'stack') : undefined;

    // Its data, correlation id and the node that threw survive the hop too (observability-review E):
    // only code and status used to, and nothing said where it was thrown.
    const error = code !== undefined && typeof status === 'number'
        ? new MeshError({
            message, code, status,
            ...(data !== undefined && !stackOnly ? { data } : {}),
            ...(correlationId !== undefined ? { correlationId } : {}),
            ...(nodeID !== undefined ? { nodeID } : {}),
        })
        : new Error(message, { cause: payload });

    // The far side's stack, then a marker naming where it threw, then ours -- so a reader sees where
    // it actually threw before seeing how the call got there.
    const remoteStack = text('stack') ?? (typeof dataStack === 'string' ? dataStack : undefined);
    if (remoteStack !== undefined) {
        error.stack = `${remoteStack}\n--- Remote Boundary${nodeID !== undefined ? ` (thrown on ${nodeID})` : ''} ---\n${error.stack ?? ''}`;
    }

    return error;
}
