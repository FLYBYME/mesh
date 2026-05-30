# Modules & Extensions

## The Module System

Mesh uses a module-based plugin architecture. Every system capability — registry, networking, database, broker — is a module that conforms to the `IMeshModule` interface and plugs into `MeshApp` via `app.use()`.

---

## IMeshModule Interface

[IMeshModule.ts](file:///home/ubuntu/code/mesh/src/interfaces/IMeshModule.ts)

```typescript
interface IMeshModule {
    readonly name: string;
    logger?: ILogger;
    serviceBroker?: IServiceBroker;
    dependencies?: string[];

    onInit?(app: IMeshApp): Promise<void> | void;
    onStart?(app: IMeshApp): Promise<void> | void;
    onStop?(app: IMeshApp): Promise<void> | void;
    onReady?(app: IMeshApp): Promise<void> | void;
}
```

| Hook | When Called | Use Case |
|---|---|---|
| `onInit` | Boot Phase 1 | Create internal state, register DI providers. `app.registerProvider(key, instance)` |
| `onStart` | Boot Phase 2 | Connect to external services, start listeners, install middleware |
| `onStop` | Teardown (reverse order) | Disconnect, drain queues, clean up resources |
| `onReady` | Boot Phase 3 | Post-start hooks (all modules are running) |

The `dependencies` array enables the `BootOrchestrator` to detect circular dependencies before any hooks run.

---

## Built-in Modules

### RegistryModule

[RegistryModule.ts](file:///home/ubuntu/code/mesh/src/modules/RegistryModule.ts)

Creates and manages the service `Registry`. Must be registered first since `NetworkModule` depends on it.

**`onInit`**: Creates a `Registry` instance with the app's `nodeID` and registers it as the `registry` provider.

**`onStart`**: Starts the registry's pruning timer (5s) and metrics timer (10s).

**`onStop`**: Clears both timers.

**Options**:
```typescript
app.use(new RegistryModule({
    preferLocal: true,    // Default. Always route to local tools first.
    dhtEnabled: false,    // Enable Kademlia DHT for large clusters.
    ttl: 30000,           // Node heartbeat TTL in ms.
}));
```

---

### NetworkModule

[NetworkModule.ts](file:///home/ubuntu/code/mesh/src/modules/NetworkModule.ts)

Creates and manages the `MeshNetwork`, which owns the full P2P networking stack (transport, dispatcher, controller, orchestrator).

**`onInit`**: Retrieves the `registry` provider. Creates a `MeshNetwork` with the configured port, transports, and bootstrap nodes. Registers as the `network` provider.

**`onStart`**: Starts the WebSocket server (if running on Node.js with a port), connects transports, starts the `MeshOrchestrator` (gossip + presence broadcasting).

**`onStop`**: Stops the orchestrator, disconnects transports, shuts down the server.

**Options**:
```typescript
const serializer = new JSONSerializer();
const wsTransport = new WSTransport(serializer, port);

app.use(new NetworkModule({
    port: 5005,
    namespace: 'production',
    bootstrapNodes: ['ws://192.168.1.10:5005'],
    transports: [wsTransport],
}));
```

**Dependency**: Requires `registry` to be registered first. Throws on `onInit` if missing.

---

### BrokerModule

[BrokerModule.ts](file:///home/ubuntu/code/mesh/src/modules/BrokerModule.ts)

Creates and manages the `ServiceBroker`.

**`onInit`**: Creates a `ServiceBroker` with the app's `nodeID` and logger. Links the broker to the `registry` and `network` providers if they exist. Registers as the `broker` provider — this triggers `MeshApp` to flush pending middleware and pending service modules.

**`onStart`**: Calls `broker.start()`, which sets `isStarted = true`, calls `onStart` on all plugins, and calls `onStart` on all registered service modules.

**`onStop`**: Calls `broker.stop()`, which clears pending requests and stops all service modules and plugins.

---

### DatabaseModule

[DatabaseModule.ts](file:///home/ubuntu/code/mesh/src/modules/DatabaseModule.ts)

Creates the MongoDB connection and installs the CRUD/TS interception middleware.

**`onInit`**: Creates a `Database` instance and registers it as the `database` provider.

**`onStart`**: Connects to MongoDB. If the broker is available, creates a `DatabaseMiddleware` and installs it as **local middleware** on the broker via `broker.useLocal()`. This means the CRUD and Time Series interception only applies to tools executed on the local node (remote RPC calls are forwarded as-is).

**`onStop`**: Disconnects from MongoDB.

**Options**:
```typescript
app.use(new DatabaseModule({
    uri: process.env.MONGODB_URI,
    dbName: 'mesh-agents'
}));
```

---

## Writing a Custom Module

Any class implementing `IMeshModule` can be plugged in:

```typescript
import type { IMeshModule, IMeshApp, ILogger } from 'mesh';

export class MetricsModule implements IMeshModule {
    public readonly name = 'metrics';
    public logger?: ILogger;
    public dependencies = ['broker']; // Will fail on circular dep check

    onInit(app: IMeshApp): void {
        this.logger = app.logger;
        // Register any providers
        app.registerProvider('metrics', this);
    }

    async onStart(app: IMeshApp): Promise<void> {
        const broker = app.getProvider<IServiceBroker>('broker');
        // Install a global middleware that records timing
        broker.use(async (ctx, next) => {
            const start = Date.now();
            try {
                return await next();
            } finally {
                const duration = Date.now() - start;
                this.logger?.info(`[Metrics] ${ctx.toolName} took ${duration}ms`);
            }
        });
    }

    async onStop(): Promise<void> {
        // Cleanup
    }
}
```

Usage:
```typescript
app.use(new RegistryModule());
app.use(new NetworkModule({ ... }));
app.use(new BrokerModule());
app.use(new MetricsModule()); // Custom module, after broker
```

---

## Module vs Service Module

These are different concepts:

| | `IMeshModule` | `ServiceModule` |
|---|---|---|
| Purpose | System infrastructure plugin | Domain service with business logic |
| Registration | `app.use(new MyModule())` | `app.registerModule(new MyService())` |
| Lifecycle | Managed by `BootOrchestrator` | Managed by `ServiceBroker` |
| Hooks | `onInit`, `onStart`, `onStop`, `onReady` | `onInit(broker)`, `onStart(broker)`, `onStop(broker)` |
| Provides | DI providers, middleware | Tools, CRUD, Time Series, events |
| Examples | RegistryModule, NetworkModule | SandboxService, InferService |

`ServiceModule` instances are registered **through** the broker (either directly or via pending queue), and the broker calls their lifecycle hooks. `IMeshModule` instances are managed directly by the `BootOrchestrator`.
