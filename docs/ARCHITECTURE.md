# Mesh Architecture

## Overview

Mesh is a decentralized, peer-to-peer microservice framework for Node.js and the browser. Every node in a Mesh network is a full peer — there are no dedicated routers, gateways, or master nodes. Services register tools (RPC endpoints) and events, which are automatically discoverable by any connected peer through gossip-based registry synchronization.

A Mesh node is composed of four core systems, each managed as a pluggable module:

| System | Module | Provider Key | Purpose |
|---|---|---|---|
| Registry | `RegistryModule` | `registry` | Tracks all known nodes, their services, and their tools |
| Network | `NetworkModule` | `network` | WebSocket transport, packet routing, deduplication |
| Database | `DatabaseModule` | `database` | MongoDB connection, CRUD/TS middleware interception |
| Broker | `BrokerModule` | `broker` | RPC dispatch, middleware pipelines, event bus |

---

## MeshApp

[MeshApp.ts](file:///home/ubuntu/code/mesh/src/core/MeshApp.ts) is the application container. It owns the module lifecycle, a dependency injection (DI) provider registry, and delegates boot sequencing to `BootOrchestrator`.

### Provider Registry (DI)

`MeshApp` maintains a `Map<string, unknown>` of named providers. Modules register themselves during `onInit`:

```typescript
// Inside RegistryModule.onInit:
app.registerProvider('registry', this.registry);

// Inside NetworkModule.onInit:
app.registerProvider('network', this.network);

// Inside BrokerModule.onInit:
app.registerProvider('broker', this.broker);
```

Any module or user code can retrieve providers:

```typescript
const broker = app.getProvider<IServiceBroker>('broker');
```

### Pending Queue Mechanism

When `registerProvider('broker', ...)` is called, `MeshApp` flushes its **`pendingMiddleware`**
queue — middleware registered via `app.use(fn)` before the broker existed — so middleware
registration order is flexible.

### Typed RPC Interface

`MeshApp` exposes a fully type-safe `call` method that delegates to the broker:

```typescript
const result = await app.call('sandbox.create', {
    name: 'my-sandbox',
    image: 'node:18',
    gitUrl: 'https://github.com/example/repo.git',
    status: 'active'
}, { timeout: 60000 });
```

The generic constraint `K extends keyof IServiceToolRegistry` is populated at compile time by the code generator, giving you autocomplete and type checking on every tool name, parameter shape, and return type.

---

## Boot Sequence

[BootOrchestrator.ts](file:///home/ubuntu/code/mesh/src/core/BootOrchestrator.ts) manages a strict three-phase startup and a reverse-order teardown.

### Phase 1: `onInit` — Initialization

Each module's `onInit(app)` is called in registration order. This is where modules:
- Receive the logger reference
- Receive the broker reference (if available yet)
- Create their internal state
- Register themselves as DI providers

The orchestrator proactively checks for the broker provider after each module's `onInit`, so that if `BrokerModule.onInit` registers the broker, subsequent modules in the same phase will receive it.

### Phase 2: `onStart` — Activation

Each module's `onStart(app)` is called in registration order. This is where:
- `RegistryModule` starts its pruning timer (every 5s) and metrics timer (every 10s)
- `NetworkModule` starts the WebSocket server, connects to bootstrap peers, and begins gossip
- `DatabaseModule` connects to MongoDB and installs the CRUD middleware onto the broker
- `BrokerModule` calls `onStart` on every registered service module

### Phase 3: `onReady` — Final State

Called after all modules have started. Currently used for post-start hooks.

### Teardown

On `app.stop()`, modules are stopped in **reverse registration order**. This ensures the broker drains before the network closes, and the network closes before the registry stops pruning.

### Circular Dependency Detection

Before any boot phase runs, the orchestrator performs a DFS cycle check on module `dependencies` arrays. If a cycle is found, it throws a `MeshError` with code `CIRCULAR_DEPENDENCY` and a trace showing the cycle path.

---

## Module Registration Order

The canonical registration order matters because modules depend on providers from earlier modules:

```typescript
app.use(new RegistryModule());      // 1. Registry (no deps)
app.use(new NetworkModule({...}));   // 2. Network (needs 'registry')
app.use(new DatabaseModule({...})); // 3. Database (no deps, but installs middleware on broker)
app.use(new BrokerModule());        // 4. Broker (needs 'registry' and 'network')
```

`NetworkModule.onInit` will throw if `registry` is not yet registered. `BrokerModule.onInit` links to both `registry` and `network` if available.

---

## Domains and Contracts

There is no service class. A domain is its contracts, and each contract names the handler module
that implements it (`filePath`) plus how it runs (`concurrency`). See
[CONTRACT_DRIVEN_PLACEMENT.md](./CONTRACT_DRIVEN_PLACEMENT.md) for the full design, and
[MIGRATION.md](./MIGRATION.md) for moving a repo off `ServiceModule`, which no longer exists.

A domain is mounted one of two ways:

1. **`broker.loadDomain(domain, handlers?, { resolve, database })`** — reads every contract
   declaring that domain out of `globalContractRegistry` and mounts each by what it declares.
   `isCrud` gets the `DatabaseMiddleware` stub, `long-running` is registered *and* called,
   `interval` self-starts on the broker-owned timer, and anything else is resolved to the handler
   its `filePath` names. Nothing enumerates contracts by hand.
2. **`broker.registerContract(contract, handler, options?)`** — one contract, directly. This is what
   `loadDomain` calls per contract, and what a standalone part uses.

`broker.unregisterContract(toolKey)` is the other half: it aborts the contract's registration-scoped
`ctx.signal` (which *is* the stop for a `long-running` or `interval` contract), clears its timer,
and removes it from local dispatch, the schema registry, `globalContractRegistry`, and this node's
advertised presence.

### Example

```typescript
// sandbox.contract.ts — the declaration
export const sandboxSetActiveContract = defineContract({
    domain: 'sandbox',
    action: 'set_active',
    filePath: 'src/sandbox/tools/setActive.ts',
    concurrency: 'on-demand',
    permissions: ['sandbox.write'],
    // ...
});

// src/sandbox/tools/setActive.ts — the handler, a plain function
export default async function setActive(params: { id: string }, ctx: IServiceContext) {
    // implementation
}
```

### CRUD Hook Lifecycle

When a CRUD tool (e.g. `sandbox.create`) is invoked:

1. `DatabaseMiddleware` intercepts the call (it checks `MeshToolSchemaRegistry` for `isCrud: true`)
2. `CrudExecutor` runs the `before` hook — you can transform input here
3. It executes the database operation via `DomainRepository`
4. It runs the `after` hook — you can transform output here
5. It emits a `data.created` / `data.updated` / `data.deleted` event automatically

Hooks are declared on `defineCrud`'s own `hooks` option (forwarded onto each action's contract, so
they are wired wherever the contract mounts) or registered directly with
`broker.registerCrudHook(domain, action, { before, after })`.

---

## Error Handling

[MeshError.ts](file:///home/ubuntu/code/mesh/src/core/MeshError.ts) provides structured errors with `message`, `code`, `status`, and optional `data`. The broker preserves error stack traces across network boundaries by appending a `--- Remote Boundary ---` marker, so you can trace the call across nodes.
