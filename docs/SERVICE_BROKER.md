# Service Broker Specification

## Overview
The `ServiceBroker` is the central communication kernel of a Mesh node. It acts as an internal message bus and router, handling all interaction between services, whether they are local to the process or reside on a remote node.

## Responsibilities
1. **Service Registration**: Storing local service schemas and their action handlers.
2. **Action Routing**: Resolving action names (e.g., `math.add`) to local handlers or remote endpoints.
3. **Event Dispatching**: Handling local and global event subscriptions.
4. **Middleware Execution**: Managing the Bipartite Pipeline (Global and Local interceptors).
5. **Context Management**: Propagating distributed tracing and security metadata via `ContextStack`.

## Bipartite Pipeline
The Broker separates execution into two phases:
1. **Global Pipeline**: Middleware that runs for *every* call (e.g., Logging, Tracing, Metrics).
2. **Local Pipeline**: Middleware that runs only for actions handled by the *local* node (e.g., Zod validation, Authorization).

## Key Components

### 1. Action Registry
Actions are registered with Zod schemas for parameters and return types. 
- **Local Cache**: Handlers are bound to the service instance.
- **Remote Resolution**: If an action is not local, the Broker queries the `ServiceRegistry` to find a target node.

### 2. Event Bus
Extends `EventEmitter3` for high-speed local event delivery.
- **Wildcards**: Supports pattern matching (e.g., `user.*`).
- **Network Bridge**: Automatically forwards local events to the `MeshNetwork` for cluster-wide propagation.

### 3. RPC Mechanism
- **Correlation IDs**: Every request is assigned a unique `nanoid`.
- **Pending Request Map**: Tracks outbound requests and their associated timeout timers.
- **Timeout Handling**: Uses `SafeTimer` to ensure clean resource disposal in both Node and Browser.

## Interface
```typescript
interface IServiceBroker {
    call<T>(action: string, params: unknown, options?: CallOptions): Promise<T>;
    emit(event: string, payload: unknown, options?: EmitOptions): void;
    on(topic: string, handler: Function): Function;
    use(middleware: IMiddleware): void;
}
```

## Distributed Tracing
The Broker ensures that `traceId`, `spanId`, and `parentId` are preserved across network boundaries by injecting them into the `IMeshPacket` metadata.
