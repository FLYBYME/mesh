# Service Broker & Contracts

## The Broker

[ServiceBroker.ts](file:///home/ubuntu/code/mesh/src/core/ServiceBroker.ts) is the central RPC and event dispatch engine. Every `broker.call()` and `broker.emit()` flows through it. It determines whether a tool is local (invoke in-process) or remote (serialize and send over the network), manages middleware pipelines, handles timeouts, and correlates request/response pairs for network RPC.

### Internal State

| Field | Type | Purpose |
|---|---|---|
| `localTools` | `Map<string, LocalTool>` | Handlers for tools registered by local service modules |
| `modules` | `IServiceModule[]` | All registered service modules |
| `globalMiddleware` | `IMiddleware[]` | Middleware applied to ALL calls (local and remote) |
| `localMiddleware` | `IMiddleware[]` | Middleware applied only to LOCAL calls (e.g. `DatabaseMiddleware`) |
| `pendingRequests` | `Map<string, {resolve, reject, timeout}>` | Correlation map for in-flight remote RPC calls |
| `plugins` | `IBrokerPlugin[]` | Lifecycle plugins |
| `localEvents` | `EventEmitter` | Local event bus for `broker.on()` / `broker.emit()` |

### Call Resolution Path

When you call `broker.call('sandbox.create', params)`:

1. **Input validation** — The broker looks up the tool's Zod `inputSchema` from `MeshToolSchemaRegistry` and calls `.parse(params)`. Invalid input throws immediately.

2. **Target resolution** — If no `options.nodeID` is specified and the tool is not in `localTools`, the broker asks the `Registry.selectNode(toolName)` to find a remote peer. The registry uses `RoundRobinBalancer` with `preferLocal: true` (local tools are always preferred).

3. **Context creation** — A full `IContext` is built with: unique `id`, `correlationID` (inherited from parent context or generated), `traceId`/`spanId`/`parentId` for distributed tracing, `toolName`, `params`, `meta` (includes timeout), and `targetNodeID`.

4. **Timeout race** — The broker creates a `Promise.race` between the actual handler execution and a timeout promise. Default timeout is **10 seconds**. Custom timeouts are resolved from: `options.timeout` → `schema.timeout` (from `defineContract`) → 10000ms fallback.

5. **Middleware pipeline** — The call passes through `globalMiddleware`, then `localMiddleware` (for local calls only), then reaches the final handler.

6. **Local execution** — If the tool is local, the broker invokes the `LocalTool.handler`, which calls `module.execute(domain, action, params, serviceCtx)`.

7. **Remote execution** — If the tool is remote, the broker calls `executeRemote()`, which serializes the request into a `MeshPacket` with `type: 'REQUEST'`, sends it via `network.send()`, and stores the correlation entry in `pendingRequests`. When the response packet arrives (via `setupNetworkListeners`), it resolves or rejects the pending promise.

8. **Output validation** — The result is parsed against the Zod `outputSchema` before being returned to the caller.

### Middleware

Middleware follows the classic `(ctx, next) => Promise<unknown>` pattern:

```typescript
// Global middleware — runs on every call
broker.use(async (ctx, next) => {
    console.log(`Calling ${ctx.toolName}`);
    const result = await next();
    console.log(`${ctx.toolName} returned`);
    return result;
});

// Local middleware — only runs when the tool is executed locally
broker.useLocal(async (ctx, next) => {
    // DatabaseMiddleware is installed here
    return await next();
});
```

The execution chain is: `globalMiddleware[0] → globalMiddleware[1] → ... → localMiddleware[0] → ... → finalHandler`.

### Network Listeners

When `setNetwork()` is called, the broker subscribes to ALL incoming packets via `network.onMessage('*', ...)` and routes them by `packet.type`:

| Packet Type | Behavior |
|---|---|
| `RESPONSE` | Resolves the pending promise in `pendingRequests` using `correlationID` |
| `RESPONSE_ERROR` | Rejects the pending promise, reconstructing the remote error with stack trace |
| `REQUEST` | Calls `handleIncomingRPC(packet)`, executes the tool locally, sends back `RESPONSE` or `RESPONSE_ERROR` |
| `EVENT` | Triggers `_triggerLocal(topic, data, packet)` on the local event bus |

### Event System

Events are emitted both locally and over the network:

```typescript
broker.emit('sandbox.created', { id: '...', name: '...' });
```

This:
1. Creates an `EVENT` packet
2. Calls `_triggerLocal()` which fires the event on the local `EventEmitter` (for `broker.on()` subscribers)
3. Also fires `__pattern_event` for wildcard (`*`) pattern subscribers
4. If `skipNetwork` is not set, publishes via `network.publish()` to all peers

**Pattern subscriptions** use regex matching:

```typescript
broker.on('sandbox.*', (data, packet) => {
    // Fires for sandbox.created, sandbox.deleted, etc.
});
```

---

## Tool Contracts

[IToolContract.ts](file:///home/ubuntu/code/mesh/src/interfaces/IToolContract.ts) defines the `ToolContract` interface and the `defineContract()` factory.

### ToolContract Interface

Every tool contract has these fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `domain` | `string` | Yes | Namespace. Must NOT contain underscores. |
| `action` | `string` | Yes | Action name within the domain. |
| `description` | `string` | Yes | Human-readable description (used in CLI and AI agent tools). |
| `inputSchema` | `z.ZodTypeAny` | Yes | Zod schema for input validation. |
| `outputSchema` | `z.ZodTypeAny` | Yes | Zod schema for output validation. |
| `rest` | `RestMeta` | Yes | HTTP method, path pattern, and stream flag. |
| `destructive` | `boolean` | No | If `true`, marks as a state-modifying tool (used by AI agents for approval flows). |
| `isCrud` | `boolean` | No | If `true`, the `DatabaseMiddleware` intercepts this tool. |
| `isTimeSeries` | `boolean` | No | If `true`, the `DatabaseMiddleware` intercepts this as a time-series tool. |
| `event` | `boolean \| string` | No | Auto-emit an event after execution. |
| `timeout` | `number` | No | Custom RPC timeout in milliseconds. |
| `print` | `(output) => string` | Yes | Formats output for CLI display and AI agent consumption. |

### defineContract()

```typescript
export const setActiveContract = defineContract({
    domain: 'sandbox',
    action: 'set_active',
    description: 'Set the active sandbox for subsequent operations.',
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.object({ success: z.boolean() }),
    rest: { method: 'POST', path: '/sandbox/set_active' },
    timeout: 5000,
    print: (out) => out.success ? 'Sandbox activated.' : 'Failed.',
});
```

`defineContract()` validates that the `domain` does not contain underscores (action names like `set_active` are allowed), then registers the contract in the `globalContractRegistry` singleton.

### Tool Key Convention

Tool keys are always `domain.action` with dot notation: `sandbox.create`, `agent.run`, `infer.chat`. The `toolKey()` function generates this, and `parseToolKey()` splits it back.

---

## CRUD Contracts

[ICrudContract.ts](file:///home/ubuntu/code/mesh/src/interfaces/ICrudContract.ts) provides `defineCrud()`, which generates **10 standard CRUD tools** from a single Zod schema:

| Action | Tool Key | Input | Output |
|---|---|---|---|
| `create` | `domain.create` | Schema minus `id`/`createdAt`/`updatedAt` | Full output schema |
| `find` | `domain.find` | `CrudParamsSchema` (limit, offset, sort, query, etc.) | Array of output schema |
| `find_one` | `domain.find_one` | `CrudParamsSchema` | Optional output schema |
| `get` | `domain.get` | `{ id: string }` | Full output schema |
| `count` | `domain.count` | `{ query?, search?, searchFields? }` | `number` |
| `update` | `domain.update` | Partial schema + `{ id: string }` | Full output schema |
| `delete` | `domain.delete` | `{ id: string }` | `{ success: boolean }` |
| `replace` | `domain.replace` | Full schema + `{ id: string }` | Full output schema |
| `resolve` | `domain.resolve` | `{ id: string \| string[] }` | Output or array |
| `create_many` | `domain.create_many` | Array of create inputs | Array of outputs |

### Output Schema Enrichment

`defineCrud` automatically adds `id: z.string()`, `createdAt: z.date()`, and `updatedAt: z.date()` to the output schema, even if the base schema doesn't have them. This ensures consistency with MongoDB's `_id` mapping.

### Custom Timeouts Per Action

```typescript
export const sandboxCrud = defineCrud('sandbox', SandboxSchema, {
    pluralPath: 'sandboxes',
    idField: 'id',
    timeout: {
        create: 60000,  // Git clone + container creation can be slow
        find: 5000,
    }
});
```

Each key in the `timeout` dictionary maps to a CRUD action name. The timeout value is passed through to the underlying `defineContract()` call.

### CrudParamsSchema

The standard query parameters for `find` and `find_one`:

```typescript
{
    limit?: number,      // Max rows to return
    offset?: number,     // Skip N rows
    fields?: string | string[],  // Projection
    sort?: string | string[],    // '-createdAt' for descending
    search?: string,             // Full-text search
    searchFields?: string | string[],
    query?: Record<string, unknown>,  // MongoDB-style filter
    populate?: string | string[],     // Relation population
}
```

---

## Event Contracts

[IEventContract.ts](file:///home/ubuntu/code/mesh/src/interfaces/IEventContract.ts) provides `defineEvent()` for declaring typed events.

### defineEvent()

```typescript
export const sandboxCreatedEvent = defineEvent(
    'sandbox.created',
    z.object({
        id: z.string(),
        name: z.string(),
        image: z.string(),
    })
);
```

This registers the event in the generated `EventRegistry` interface, enabling type-safe `broker.on('sandbox.created', ...)` and `broker.emit('sandbox.created', ...)`.

### Built-in Events

| Event | Schema | Emitted By |
|---|---|---|
| `mesh.started` | `{ timestamp, nodeID }` | MeshApp on start |
| `mesh.stopped` | `{ timestamp, nodeID, reason? }` | MeshApp on stop |
| `data.created` | `{ domain, id, item }` | DatabaseMiddleware after create |
| `data.updated` | `{ domain, id, patch, item }` | DatabaseMiddleware after update/replace |
| `data.deleted` | `{ domain, id }` | DatabaseMiddleware after delete |

---

## MeshToolSchemaRegistry

This is a global `Map<string, {...}>` in `ServiceBroker.ts` that stores runtime metadata for every registered tool:

```typescript
{
    params: z.ZodTypeAny,    // Input schema
    returns: z.ZodTypeAny,   // Output schema
    mutates: boolean,        // Destructive flag
    timeout: number,         // Custom timeout
    isCrud: boolean,         // CRUD interception flag
    isTimeSeries: boolean,   // TS interception flag
    domain: string           // Domain namespace
}
```

Both `ServiceBroker.call()` and `DatabaseMiddleware` consult this registry to determine validation schemas, timeouts, and whether CRUD/TS interception should apply.

---

## Time Series Contracts

[ITimeSeriesContract.ts](file:///home/ubuntu/code/mesh/src/interfaces/ITimeSeriesContract.ts) provides `defineTimeSeries()`, which generates **4 standard tools** for handling time-indexed data:

| Action | Tool Key | Purpose |
|---|---|---|
| `insert` | `domain.insert` | Batch insertion of data points |
| `query` | `domain.query` | Range-based retrieval with tag filtering |
| `aggregate` | `domain.aggregate` | Time-bucketed statistics (min, max, avg, etc.) |
| `latest` | `domain.latest` | Get the single most recent data point |

The framework automatically manages a **MongoDB Time Series collection** for these tools, handling metadata mapping and aggregation pipelines transparently.

---

## Code Generation
...
The [GenerateCommand](file:///home/ubuntu/code/mesh/src/cli/commands/GenerateCommand.ts) scans all `*.contract.ts` files and generates three artifacts under `src/generated/`:

1. **`api.ts`** — Module augmentation of `IServiceToolRegistry` with type-safe tool signatures
2. **`events.ts`** — Module augmentation of `EventRegistry` with typed event payloads
3. **`cli/ToolCommands.ts`** — Auto-generated Commander subcommands for every tool

This is what gives you compile-time autocomplete on `broker.call('sandbox.create', ...)`.
