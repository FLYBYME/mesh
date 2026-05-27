// Inferred interface for resilience patterns like retries, circuit breakers.
export interface IResiliencyAdapter {
  /** Executes a function with retry logic. */
  executeWithRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T>;
  /** Executes a function with circuit breaker logic. */
  executeWithCircuitBreaker<T>(fn: () => Promise<T>, options?: CircuitBreakerOptions): Promise<T>;
}

// Placeholder interfaces for options. Actual types might be more detailed.
interface RetryOptions {
  retries?: number;
  delay?: number; // Delay in milliseconds between retries.
  shouldRetry?: (error: unknown) => boolean; // Function to determine if a retry should occur.
}

interface CircuitBreakerOptions {
  failureThreshold?: number; // Number of failures before opening the circuit.
  successThreshold?: number; // Number of successes after closing the circuit.
  timeout?: number; // Timeout in milliseconds for the breaker to remain open.
}
