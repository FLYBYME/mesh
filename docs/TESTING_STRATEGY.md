# Testing Strategy Specification

## Overview
The Mesh project follows a strict testing protocol to ensure cross-platform (Isomorphic) compatibility and resilience. The suite is built with **Jest** and **ts-jest**.

## Testing Tiers

### 1. Unit Tests
- **Scope**: Individual classes and utilities (`ServiceBroker`, `KademliaRoutingTable`, `IsomorphicCrypto`).
- **Isolation**: Dependencies are mocked using Jest's `jest.fn()` or specialized mock implementations like `MockTransport`.
- **Location**: `src/**/*.spec.ts`.

### 2. Integration Tests
- **Scope**: Interaction between Core components (`MeshApp` + `MeshNetwork` + `ServiceRegistry`).
- **Mechanism**: Utilizes `MockTransport` to simulate a "live" network in a single process.
- **Goals**: Verify event propagation, service discovery timing, and load balancing selection.

### 3. Resilience Tests (Chaos)
- **Scope**: Interceptors and network failures.
- **Scenarios**:
  - Tripping the `CircuitBreaker` with 5 consecutive failures.
  - Triggering `RateLimit` by flooding with packets.
  - Node pruning verification by advancing timers with `jest.useFakeTimers()`.

## Best Practices

### 1. Time Management
Many Mesh components (`ServiceRegistry`, `RateLimitInterceptor`, `MeshNetwork`) rely on timers.
- **Fake Timers**: Use `jest.useFakeTimers()` for pruning and TTL tests.
- **Real Timers**: Switch to `jest.useRealTimers()` for async/await tests that depend on `setTimeout` closures (like `waitForService`).

### 2. Isomorphic Validation
Tests must be runnable in both Node.js and simulated Browser environments.
- **`Env.isNode()` Checks**: Use conditional blocks for Node-specific features like `node:zlib` compression or `UnifiedServer`.

### 3. Packet Identity
When testing networking, always verify:
- `packet.id` consistency.
- `meta.ttl` decrementing.
- `meta.path` growth.

## Key Mocking Utilities
- **`MockTransport`**: In-memory protocol driver.
- **`ConsoleLogger`**: Silent or mock logger to keep test output clean.
- **`BaseSerializer`**: `JSONSerializer` is used as the default for tests.

## Running Tests
```bash
# Run all tests
npm test

# Run a specific module
npx jest src/core/MeshApp.spec.ts

# Watch mode for development
npx jest --watch
```
