import type { IContext  } from './IContext';
import { MeshError } from '../core/MeshError';

export type StreamStatus = 'OPEN' | 'PAUSED' | 'CLOSED' | 'ERROR';

/**
 * IMeshStream — The primary interface for a backpressure-aware stream handle.
 */
export interface IMeshStream<TResult = unknown> {
    /** Unique UUID/Nanoid for the stream instance. */
    readonly id: string;
    
    /** The current state of the pipeline. */
    readonly status: StreamStatus;

    /** 
     * Sends data down the stream. 
     * Must await to respect backpressure.
     */
    write(data: TResult): Promise<void>;

    /** Gracefully ends the stream. */
    end(): Promise<void>;

    /** Propagates an error and closes the stream. */
    error(err: MeshError): Promise<void>;

    /** Standard listener for incoming chunks. */
    on(event: 'data', handler: (data: TResult) => void): void;
    
    /** Error propagation listener. */
    on(event: 'error', handler: (err: MeshError) => void): void;
    
    /** Clean closure signal listener. */
    on(event: 'end', handler: () => void): void;

    /** Internal: Resume writing (called when STREAM_ACK is received). */
    resume?(): void;
}

/**
 * IStreamContext — Extends IContext to provide stream-specific utilities.
 */
export interface IStreamContext<TParams = Record<string, unknown>, TMeta = Record<string, unknown>> extends IContext<TParams, TMeta> {
    /** Access to the underlying stream controller. */
    readonly stream: IMeshStream<unknown>;
    
    /** Flag indicating if the consumer has disconnected. */
    readonly isCanceled: boolean;
}
