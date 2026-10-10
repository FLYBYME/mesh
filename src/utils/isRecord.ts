/** Whether a value is a plain object to read fields from (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * What an error says, whatever was thrown: its message for an Error, else the value as text.
 * Written inline 201 times across the services before this (10-10).
 */
export function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
