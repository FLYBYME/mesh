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

When `registerProvider('broker', ...)` is called, `MeshApp` flushes two queues:

1. **`pendingMiddleware`** — Middleware registered via `app.use(fn)` before the broker existed.
2. **`pendingModules`** — Service modules registered via `app.registerModule(mod)` before the broker existed.

This means module registration order is flexible. You can call `app.registerModule(new SandboxService())` before `app.use(new BrokerModule())`, and it will work correctly.

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

## Service Modules

[ServiceModule.ts](file:///home/ubuntu/code/mesh/src/core/ServiceModule.ts) is the abstract base class for all domain services. A service declares:

1. **A `domain` name** — a unique namespace string (e.g. `'sandbox'`, `'agent'`, `'infer'`)
2. **Tool mounts** — via `this.mountTool(contract, handler)`
3. **CRUD mounts** — via `this.mountCrud(crudContracts)` (handlers are intercepted by `DatabaseMiddleware`)
4. **Time Series mounts** — via `this.mountTimeSeries(tsContracts)`
5. **CRUD hooks** — via `this.mountCrudHook(domain, action, { before, after })`
6. **Event handlers** — via `this.mountEventHandler('event.name', handler)`

### Example

```typescript
export class SandboxService extends ServiceModule {
    public readonly domain = 'sandbox';

    constructor() {
        super();
        this.mountCrud(sandboxCrud);
        this.mountTool(setActiveContract, this.handleSetActive.bind(this));
        this.mountTool(fsReadContract, this.handleFsRead.bind(this));
        this.mountEventHandler('data.created', (payload, ctx) => {
            if (payload.domain === 'sandbox') {
                // post-creation provisioning
            }
        });
    }

    private async handleSetActive(params: { id: string }, ctx: IServiceContext) {
        // implementation
    }
}
```

### CRUD Hook Lifecycle

When a CRUD tool (e.g. `sandbox.create`) is invoked:

1. `DatabaseMiddleware` intercepts the call (it checks `MeshToolSchemaRegistry` for `isCrud: true`)
2. It calls `module.beforeCrud(domain, action, params, ctx)` — you can transform input here
3. It executes the database operation via `DomainRepository`
4. It calls `module.afterCrud(domain, action, result, ctx)` — you can transform output here
5. It emits a `data.created` / `data.updated` / `data.deleted` event automatically

---

## Error Handling

[MeshError.ts](file:///home/ubuntu/code/mesh/src/core/MeshError.ts) provides structured errors with `message`, `code`, `status`, and optional `data`. The broker preserves error stack traces across network boundaries by appending a `--- Remote Boundary ---` marker, so you can trace the call across nodes.
