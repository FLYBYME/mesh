# The Supervisor, real dynamic service lifecycle, and built-in test running

**Status: Part 1, step 2, and Part 2 of the build order built and verified 2026-08-25 (see the "status" notes inline below). Part 3 not yet built.** Design doc + build assignment, written 2026-08-25. This is framework-level, not application-level — nothing here is specific to any one project built on `@flybyme/mesh`. Read `ARCHITECTURE.md` and `MODULES_AND_EXTENSIONS.md` first if you haven't already; this doc assumes you know what a `ServiceModule`, a `MeshApp`, and the `ServiceBroker`/`Registry` split are.

## Why this exists

Today, running a mesh node means `mesh start --services <dir>` — one process, one fixed set of services, decided at process-start time and never changed again short of killing and restarting the whole process. There is no way to:

- Start or stop *one* service without taking down every other service sharing that process.
- Change which services a running node hosts without a restart.
- Describe, in one place, "here are all the services that exist, where each one should run, and what it depends on" and have something act on that description.
- Ask a running service, over the network, "run your own tests and tell me if they pass" — today that's a completely separate, disconnected activity (a `vitest`/`jest` process on a developer's machine) with no relationship to the actual running system.

This doc covers three things, in dependency order, because each one is built on the last: **(1)** real dynamic service lifecycle at the `ServiceBroker` level, **(2)** the Supervisor, a config-driven process that uses (1) to run a whole fleet of services in one process and manage them individually, and **(3)** a test-running capability built into the Supervisor itself, so a contract can be associated with a set of tests that run for real, against a real running instance, on demand.

## Part 1 — real dynamic service lifecycle (the actual gap)

**Confirmed by reading the current source, not assumed:** `MeshApp.use(module)` only works before `app.start()` — there is no runtime "mount this now" or "unmount just this one service" today. `ServiceBroker.registerModule` exists and does real work (pushes onto `this.modules`, calls `module.onInit`, registers every contract into `MeshToolSchemaRegistry` and `this.localTools`, tells `this.registry` about it, subscribes declarative event handlers) — but **there is no `ServiceBroker.unregisterModule`**, even though `Registry.unregisterModule(domain)` already exists (`Registry.ts:215`) and does the registry-side half correctly (removes from `localModules`, filters the local node's advertised `services`, bumps `nodeSeq`, re-announces). This exact asymmetry is why `RUNNING.md` in the `paas` repo already flags it as a "known unfixed follow-up" — nothing has ever actually exercised a partial in-process teardown, so the gap was never hit until now.

### What to build

`ServiceBroker.unregisterModule(domain: string): Promise<void>`:

1. Find the registered `IServiceModule` instance for `domain` in `this.modules` (error if not found — unregistering something never registered is a caller bug, not a no-op).
2. **Call `module.onStop?.(this)` first, and await it**, before touching any broker/registry state. This is the service's own chance to release *its* resources — clear its own `setInterval`/`setTimeout` handles, close its own sockets/file handles, drop its own in-memory caches. The framework cannot know what a given service allocated; it can only guarantee the hook is actually called, every time, in the right order. (This mirrors the exact fix already made once in `paas` for `SshService.onStop` — a `shutdown()` method that existed but was never invoked by anything, because the framework had no real lifecycle hook wired to call it. Don't repeat that mistake here at the framework level.)
3. Remove every contract this module registered from `this.localTools` (iterate `module.getContracts()`, delete each `${domain}.${action}` key) and from `MeshToolSchemaRegistry` (same keys).
4. Unsubscribe any event handlers this module registered via `mountEventHandler` (the broker needs to track *which* handler came from *which* module to do this — check whether that mapping already exists anywhere, or needs adding as part of this work).
5. Remove the module from `this.modules`.
6. Call `this.registry.unregisterModule(domain)` (already correct, per above).
7. Log a real, specific confirmation — what was torn down, not just "done."

**A real, load-bearing test for this, not an incidental one**: register a service with a `setInterval` timer running in `onStart` and a real counter it increments, call `unregisterModule`, then assert the interval genuinely stopped firing (wait past a few more tick intervals, assert the counter didn't move) — proving cleanup actually happened, not just that the code path ran without throwing. Also assert `broker.call('<domain>.<action>', ...)` now fails with a real "not found" error (using the improved error message already built — see `ServiceBroker.ts`'s `handlePipeline`) after unregistering, and that a *different* still-registered service is completely unaffected.

### Part 1 — status: built (`mesh` commit `f76236b`)

Built exactly as specced above: `ServiceBroker.unregisterModule` calls `onStop` first, tears down `localTools`/`MeshToolSchemaRegistry`/tracked event listeners (a new `moduleEventListeners` map was needed — `registerModule`'s event subscriptions were anonymous inline closures with no stored reference, so nothing could `.off()` a specific module's listeners before this), removes the module from `this.modules`, then delegates to the already-correct `Registry.unregisterModule`. The load-bearing `setInterval` test (`src/__tests__/core/ServiceBroker.spec.ts`, `describe('unregisterModule()', ...)`) passes: the timer genuinely stops, the tool call fails with a real not-found error, the event handler stops receiving, and an unrelated still-registered service is unaffected throughout. Full suite: 251/258 (7 pre-existing unrelated `AuthInterceptor.spec.ts` failures, same as before this change).

### Step 2 — status: built (`mesh` commit `5ca6e13`)

**Finding, not assumed:** real cross-node namespace isolation already existed before this step, at the packet layer — `MeshNetwork`'s inbound packet handler (`MeshNetwork.ts`) already drops *any* packet (presence, PEX, RPC request/response, ping/pong, everything) whose `packet.namespace` differs from the receiving node's own `this.namespace`, unconditionally, for every packet type. So a foreign-namespace peer's presence/PEX literally never reaches the point where `Registry.registerNode` would be called for it — this is stronger than doc-writing-time assumed ("Registry's routing doesn't filter by namespace at all").

The actual live bug found: `RegistryModule` never passed `app.namespace` into `new Registry(...)`, so `Registry`'s own local node entry — the one *this* node advertises about itself via presence/PEX — always claimed `namespace: 'default'` regardless of what the node was actually configured with. A node started with `namespace: 'test'` would correctly have its outbound packets tagged `'test'` (by `MeshNetwork`, which *did* get `app.namespace` correctly via `NetworkModule`) and correctly filter inbound packets by `'test'` — but its own Registry bookkeeping about itself was silently wrong, which would have broken any future logic that trusted `registry.getNode(nodeID).namespace` for the local node.

Fixed: `Registry` now takes a real `namespace` option (defaulting to `'default'`, same as before, just no longer hardcoded), `RegistryModule` passes `app.namespace` through. `findNodesForTool`/`getNextToolEndpoint` (and therefore `selectNode`) now also filter candidates to same-namespace nodes — defense-in-depth on top of the packet-layer filter, not the primary enforcement mechanism (that's still `MeshNetwork`). `NetworkController.handleAnnounce`'s hardcoded `namespace: 'default'` was also fixed for correctness, though `$node.announce` currently has no publisher anywhere in the codebase (dead code path today).

New `src/__tests__/core/NamespaceIsolation.spec.ts`: a real 3-node test over real `WSTransport` connections (not mocked) proving a `'test'`-namespace node never discovers or can call a `'default'`-namespace node's tool — directly or transitively through a same-namespace relay — while same-namespace nodes still discover and route to each other fine across hops.

**Open question carried into Part 3, not yet resolved:** a whole `MeshNetwork`/`MeshApp` process is pinned to exactly *one* namespace value for its entire life (set once at construction, e.g. via `TestAppOptions.namespace`). There is currently no way for a single process's `ServiceBroker` to host two different-namespace instances of the *same* domain simultaneously — `localTools` is keyed by `${domain}.${action}` with no namespace component, so a second `registerModule` call for an already-mounted domain would collide, not coexist. If Part 3's "run an isolated `test`-namespace instance without touching the `default`-namespace production instance" needs both to live inside one Supervisor process at once, this needs a real design decision (e.g. a namespace-qualified `localTools` key, or running the test instance as a logically separate in-process `MeshApp`/broker pair rather than mounting it onto the Supervisor's own broker) before Part 3 can be built safely. Not resolved here — flagging it now because it's the direct consequence of what this step found.

## Part 2 — the Supervisor

A new `mesh supervise` CLI command (alongside the existing `start`), built entirely on Part 1 — the Supervisor doesn't spawn child processes; every service it manages runs inside the Supervisor's own single process, dynamically mounted/unmounted via `registerModule`/`unregisterModule`.

### Config shape

```json
{
  "services": [
    {
      "name": "identity",
      "path": "./dist/auth/identity/identity.service.js",
      "dependsOn": []
    },
    {
      "name": "quota",
      "path": "./dist/auth/quota/quota.service.js",
      "dependsOn": ["identity"]
    }
  ]
}
```

- `name` — a stable identifier for this entry, used in the control API/CLI to target it. Not necessarily the same as the service's own `domain` (a service could theoretically be started under a different logical name, though the common case is they match).
- `path` — where to `import()` the compiled service module from. Dynamic `import()`, not a static require list — this is what makes "run just from the git repo" real: point `path` at a freshly-`tsc`-compiled file (or, later, a `ts-node`/on-the-fly-transpiled one for true run-from-source) and it loads whatever's there right now, no rebuild-the-whole-image step.
- `dependsOn` — other entries' `name`s that must be running before this one starts. The Supervisor topologically sorts the manifest and starts services in dependency order; a manifest with a cycle is a real startup error, not silently ignored.

### Control surface

The Supervisor needs a way to be told "start this," "stop this," "restart this," "what's currently running," at runtime — not just at boot from the config file. Two real options, not mutually exclusive, pick based on how this actually gets used once built:

- **CLI subcommands** talking to an already-running Supervisor process over a local control channel (a Unix socket or a loopback-only HTTP/WS port) — `mesh supervisor start <name>`, `mesh supervisor stop <name>`, `mesh supervisor restart <name>`, `mesh supervisor status`.
- **Mesh contracts of its own** — the Supervisor is itself running a `ServiceModule` (bootstrapped specially, before the dynamic system it manages) exposing `supervisor.service_start`/`service_stop`/`service_restart`/`service_status` as real, normal mesh contracts, callable the same way anything else in this system is called. This is likely the more useful shape long-term (fits `paas`'s own "everything is a contract" convention, and Part 3's test-running capability wants to be a contract anyway) — but confirm a local-only control path also exists for the case where the Supervisor's own broker isn't reachable (e.g. mid-crash-loop).

### Restart / crash behavior

A service that throws during `onStart` or crashes its process-wide effects (an uncaught exception inside one of its handlers, if that's even isolable in a single process — investigate whether it's realistic to contain a fault to one service when everything shares one Node process, or whether this needs a documented, honest limitation) should be restartable via `service_restart`, which is exactly `unregisterModule` followed by a fresh `registerModule` on a new instance — not a special code path.

### Part 2 — status: built (`mesh` commit `3435ba7`, `src/supervisor/`)

Built per the config shape and control-surface recommendation above, resolving the two open questions as follows:

- **Control surface**: both, as the doc suggested — `SupervisorService` (`src/supervisor/SupervisorService.ts`) is a real `ServiceModule` mounted first, before any manifest-defined service, exposing `supervisor.service_start`/`service_stop`/`service_restart`/`service_status` as real mesh contracts. The local-only path for the crash-loop case (a Unix socket / loopback control channel reachable even if the Supervisor's own broker is down) was **not built in this pass** — today, if the Supervisor's own broker/network genuinely can't come up, there's no way to reach it at all. Scoped out deliberately (see "What NOT to build" below), flagged here as a real, known gap rather than silently assumed away.
- **Restart/dependent handling**: `service_stop` (and therefore `service_restart`, which calls it) refuses to stop a service that other currently-*running* services still depend on, returning a real error naming them, unless `cascade: true` is passed — in which case dependents are stopped first, recursively, before the target. This wasn't explicitly specified in the design above; it's the natural complement to `dependsOn` ordering `startAll` already needed, and avoids silently breaking a running dependent out from under itself.
- **Partial-failure startup**: `startAll` starts every manifest entry in dependency order; a service whose `path` fails to `import()` (or whose `onStart`/`registerModule` throws) is marked `status: 'error'` with the real error message, and any entry depending on it — directly or transitively — is also marked `'error'` (reason: `"Skipped: dependency not running: <names>"`) rather than being silently started against a broken dependency.
- **Dynamic `import()`**: resolves `path` relative to the manifest file's own directory (absolute paths pass through unchanged), then looks for a default export first, falling back to the first exported function/class — mirrors the exact pattern `StartCommand.loadServicesFromDirectory` already used for `mesh start --services <dir>`.

Verified: `src/__tests__/supervisor/Supervisor.spec.ts` (13 tests: cycle detection, manifest validation against real files on disk, and a full real-`MeshApp`/real-`ServiceBroker` integration suite using real fixture `.service.ts` files under `src/__tests__/fixtures/supervisor/` — dependency-ordered start, the cascade-stop dependent guard, proof a restarted service is a genuinely new instance (compared by a per-instance random id, not just "didn't throw"), partial-failure skip propagation, and the same lifecycle exercised through the real `supervisor.*` mesh contracts rather than calling `Supervisor`'s methods directly). Also smoke-tested end-to-end outside the test suite: built the CLI, ran `mesh supervise --config <manifest>` pointing at a real compiled `dist/examples/demo/demo.service.js`, called `demo.hello` and `supervisor.service_status` from a separate real client process over a real `WSTransport` connection, and confirmed `SIGTERM` cleanly tears the dynamically-started service down (`unregisterModule` teardown visible in the logs) before the process exits.

**Left out of this pass, on purpose:** the local-only control channel noted above; true process-level fault isolation between services sharing the Supervisor's one process (not attempted — see "What NOT to build" below, unchanged); any config hot-reload (editing the manifest file on disk while the Supervisor is running currently does nothing until restarted with a new `--config` read — `loadManifest` is only ever called once, at CLI startup).

## Part 3 — tests built into the Supervisor

The actual ask: "I can call a contract and a set of tests will run and return the result." Concretely:

- A way to **associate** a set of tests with a contract or a service (a real convention needed here — e.g. a service's own module exposes a `getTests()` method, or a sibling `<service>.tests.js` file the Supervisor loads alongside `path`, or tests register themselves against a domain name at import time via some registration call — pick one, don't leave this as an open menu).
- A new contract, e.g. `supervisor.run_tests({ domain, testName? })`, that finds the currently-running instance of that service (mounted via Part 1/2, so it's a real, live instance, not a fresh throwaway one), executes its associated test(s) for real against that live instance, and returns a real structured result (`{ passed, failed, results: [{ name, ok, error? }] }`) — not a boolean, not a log dump.
- This is where `namespace` (currently inert metadata, see below) becomes load-bearing: a test run should be able to specify (or the Supervisor should default to) running against an instance in a `test` namespace backed by a test database, not accidentally exercising a `default`-namespace production instance. **`namespace` needs to actually gate something before this is safe** — today it's stored but never checked anywhere in `Registry`'s routing (`selectNode`/`findNodesForTool` don't filter by it). Making `namespace` real (peers only discover/route to same-namespace nodes unless explicitly told to cross) is a real prerequisite for Part 3, not a nice-to-have alongside it.

### What NOT to build in this pass

No attempt at true process-level fault isolation between services sharing one Supervisor process (that's what separate OS processes/containers are for — if that level of isolation is needed for a specific service, it doesn't belong under the Supervisor, it runs as its own `mesh start` process instead). No distributed/multi-Supervisor coordination (one Supervisor manages the services in its own process; a fleet of Supervisors coordinating with each other is a real future need but not this pass — each Supervisor is just a normal mesh node from every other node's perspective). No UI — CLI and contracts only.

## Build order

1. `ServiceBroker.unregisterModule` (Part 1) — the real load-bearing test above must pass before anything else is built on top of it.
2. `namespace`-aware routing in `Registry` (a real prerequisite for Part 3, cheap to do now while touching this area).
3. The Supervisor itself (Part 2) — config parsing, dependency-ordered start, dynamic `import()`, the control surface (pick CLI-only vs. contract-based vs. both, per the open question above, before starting this).
4. Test-running (Part 3) — needs 1-3 already real.
