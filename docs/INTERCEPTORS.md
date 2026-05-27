# Interceptors & Middleware Specification

## Overview
Interceptors provide a powerful mechanism to hook into the lifecycle of mesh packets. They follow the decorator pattern and are executed in a pipeline for both inbound and outbound traffic.

## Pipeline Architecture
- **Inbound Pipeline**: Executed when a packet is received from the network, *before* it reaches the `ServiceBroker`.
- **Outbound Pipeline**: Executed when a packet is being sent *to* the network.

Each interceptor must implement the `IInterceptor` interface:
```typescript
interface IInterceptor<TIn = MeshPacket, TOut = MeshPacket> {
    readonly name: string;
    onInbound?(packet: TIn): Promise<TOut> | TOut;
    onOutbound?(packet: TOut): Promise<TIn> | TIn;
    stop?(): Promise<void> | void;
}
```

## Standard Interceptors

### 1. Circuit Breaker (`CircuitBreakerInterceptor`)
Protects the system from cascading failures by "tripping" the connection to unstable nodes.
- **States**: `CLOSED` (Normal), `OPEN` (Rejected), `HALF_OPEN` (Trial).
- **Threshold**: Defaults to 5 consecutive failures.
- **Timeout**: Reset timeout defaults to 30 seconds.
- **Action**: In `OPEN` state, it changes the packet topic to `__circuit_open`, effectively dropping it.

### 2. Rate Limiter (`RateLimitInterceptor`)
Prevents node overload by limiting the number of inbound packets per window.
- **Strategy**: Sliding window counter.
- **Scope**: Can be scoped by `senderNodeID` or `tenant_id`.
- **Action**: Drops packets exceeding the limit by changing the topic to `__dropped`.

### 3. Compression (`CompressionInterceptor`)
Reduces network bandwidth usage by compressing large payloads.
- **Mechanism**: Gzip (Node.js) / No-op (Browser).
- **Metadata**: Sets `meta.compressed = true`.

### 4. Trace Interceptor (`TraceInterceptor`)
Ensures distributed tracing context is propagated across the mesh.
- **Metadata**: Injects `traceId`, `spanId`, and `parentId` into packet headers.

### 5. Worker Proxy (`WorkerProxyInterceptor`)
Enables "Hub-and-Spoke" patterns by proxying requests to worker nodes.
- **Logic**: If the local node is a Hub and doesn't host the service, it finds a child Worker node that does.

## Error Handling
Interceptors can throw errors to abort packet processing. If an error is thrown in the outbound pipeline, the packet is not sent, and the caller receives the error immediately.
