export interface IResiliencyAdapter {
    /** Executes a function with retry logic. */
    executeWithRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T>;
    /** Executes a function with circuit breaker logic. */
    executeWithCircuitBreaker<T>(fn: () => Promise<T>, options?: CircuitBreakerOptions): Promise<T>;
}
interface RetryOptions {
    retries?: number;
    delay?: number;
    shouldRetry?: (error: unknown) => boolean;
}
interface CircuitBreakerOptions {
    failureThreshold?: number;
    successThreshold?: number;
    timeout?: number;
}
export {};
