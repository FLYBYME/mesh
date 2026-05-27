// Inferred interface for standardized MeshError shapes.
export interface IMeshError extends Error {
  /** A machine-readable error code. */
  code: string | number;
  message: string;
  /** Additional context or data related to the error. */
  data?: Record<string, unknown>;
  // Potentially other properties like timestamp, stack trace etc.
}
