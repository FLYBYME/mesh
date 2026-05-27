import { z } from 'zod';

/**
 * IMeshApi: Marker interface for the Unified API.
 * Code generators produce the concrete implementation.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IMeshApi {}

/**
 * PlatformEvent: The unified event shape for the mesh ecosystem.
 */
export const PlatformEventSchema = z.object({
    id: z.string().uuid(),
    timestamp: z.date(),
    correlationId: z.string().describe("Trace ID for request lifecycle tracking"),
    domain: z.string(),
    action: z.string(),
    payload: z.record(z.string(), z.unknown())
});

export type PlatformEvent = z.infer<typeof PlatformEventSchema>;
