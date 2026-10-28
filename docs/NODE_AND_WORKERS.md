# One node per machine, handlers in worker threads

**Status: decided, not built (owner, 10-28). This is mesh 5.** The shape of mesh from here: a network stack, contracts,
and a reference from each contract to the code that serves it. Where that code runs is placement,
not packaging.

## What is decided

1. **One node per machine, not per process.** The node owns the transport, the registry, routing,
   claims, and the database pool. It runs no handler code itself.
2. **Handlers run in worker threads under the node.** A worker is a V8 isolate with its own heap,
   event loop and memory cap (`resourceLimits`); `terminate()` frees all of it. Its starting cost
   (Node's runtime, mesh's worker side, zod, the handler's own imports) is the price, and it is
   paid: a leak or a crash costs one worker, never the node, and a busy handler cannot hold up
   heartbeats or routing.
3. **No other isolation kind.** Mesh runs only code its operator wrote and trusts. Workers are for
   memory and faults, not security: no sandboxed worker, no `vm` contexts, no `isolated-vm`.
4. **One database pool per node.** Handlers reach the database only through CRUD contracts and
   `ctx.db`, so in a worker `ctx.db` is a call to the node over the frame channel. Workers load no
   database driver and hold no connections; tenancy and hidden fields are enforced in one place.
5. **No state in a handler's memory.** Whatever produces a piece of state owns it and exposes it
   through contracts and events (a route table belongs to whatever writes routes; a proxy reads it,
   and keeps at most a cache rebuilt from its events). A unit that must hold state has exactly one
   owner, claimed in shared storage (see "Owned units").
6. **A contract references its code; there is no register file and no index.**

## Contracts reference their handlers

```ts
export const workflowRunContract = defineContract({
    domain: 'workflow', action: 'run',
    inputSchema, outputSchema, /* ... */
    handler: () => import('../tools/run.js').then((m) => m.run),
});
```

- Typed: `defineContract` checks `run` against the contract's input and output. It replaces the
  `filePath` string.
- Lazy: importing a contract to call it (another package does) loads no handler code and none of
  its dependencies. Only a node serving the contract loads it, on first use, in a worker.
- `defineEventHandler` takes a `handler` the same way. Interval and long-running contracts cover
  startup work, with `ctx.signal` as the stop.

**Mounting:** what a package defines is what it serves. `mesh-serve generate` (the low-level one, not
the api client) already finds every contract a package defines and writes `src/generated/api.ts`; it
also writes `src/generated/part.ts`, the list of those contracts, CRUD definitions and event
handlers, and the loader mounts that list. One scan writes both, so the types and what is mounted
(and so what `/_describe` lists) cannot disagree -- today they can: the types come from the scan,
the mounting from a hand-written `register.ts`.

**The scan loads the files instead of matching their text.** A contract file with lazy handlers
imports only zod and other contracts, so loading it is cheap; reading the real objects replaces the
regexes that skip any contract not written as one plain literal (`...common` holding its `domain`).
The same loader replaces `discoverPartContracts` in the build.

**Only contracts defined in the package are mounted.** A package imports others' contracts to call
them; a re-export must never make it serve them. The build refuses a contract whose handler module
is outside the package.

## Per-handler builds and dependency maps

Each lazy `import()` is a split point the bundler sees: with splitting, every handler is its own
content-hashed chunk holding exactly what it imports, whatever folder it is in; shared code lands in
shared chunks. The build's metafile gives, per contract:

- **its code:** the modules and packages in its chunk. The hash changes only when they do, so a
  deploy moves only the handlers that changed.
- **the contracts it calls:** `ctx.call('x.y', ...)` is a typed literal, so the call graph is read at
  build time -- for placement (callers near what they call), for what a change affects, and to
  generate what a handler `wants` instead of listing it by hand.
- **the events it handles and emits.**

A node answers "what must I load to serve X" from the map.

## Owned units

Most handlers are stateless: any worker on any node serving the contract runs them. A unit that
holds state (a queue, a listener with a table) has one owner:

- claimed with a conditional write in shared storage; each claim advances a fencing epoch, and
  writes carry it, so a stale owner's writes are refused;
- held by a lease the owner renews; an owner that loses it stops by itself;
- taken over by the next claimant when the lease lapses.

`delivery: 'one'` events already claim this way, per event (`mesh.eventClaims`, 4.14.13).

## Placement and scaling (the critical part)

Every contract has a placement kind:

- **anywhere** -- stateless; any number of copies, on any nodes, at once. Most contracts. CRUD is the
  extreme case: every node holds the database pool and the framework is the handler, so a CRUD call
  never leaves the node that makes it (an api's reads and writes stay in the api's node).
- **owned** -- exactly one owner at a time (see "Owned units").
- **pinned** -- needs what only some machines have (a public port, the host network); placed by label.

**Anywhere contracts follow their calls.** Each node already counts its outgoing calls per contract
and per peer (`recordOutgoing` / `recordOutgoingPeer`). That is the heat map: when a node keeps
calling an anywhere contract on another node above a threshold, it loads that contract's chunk into
one of its own workers, and from then on the calls are local (a local endpoint is preferred). A copy
cold for a while is dropped again. Each node decides from its own counters: no central scheduler.

**Memory is traded for throughput, on purpose.** The same chunk loaded ten times across the mesh is
fine: ten copies of a handler cost memory; a remote hop on every call costs latency and the links.
A node keeps a memory budget for copies; past it the coldest copies go first. Owned and pinned
units are never dropped for room.

**Chains come along.** The dependency map knows what a contract calls, so when a contract turns hot
its callees that are anywhere become candidates too -- a proxy's chain of calls ends up local, not
one hop at a time.

**While a copy loads**, calls keep going where they went; nothing waits on a load.

## The frame channel

Between the node and its workers: `postMessage` (decided, 10-28), with buffers transferred, not
copied. The node reads only a small header (topic, target, id) to route; the worker decodes the body.

## Open, to measure first

- A worker's real starting cost with mesh's worker side loaded, alone and ten at once.
- How handlers group into workers (by domain is the first rule), and each group's heap cap.
- Call latency through the channel against in-process, and against a remote hop -- which sets the
  heat threshold for loading a local copy.
- How long a copy may stay cold before it is dropped.

## Order

1. `handler` on `defineContract` and `defineEventHandler` (mesh); `generate` loads the files and
   writes `part.ts` (mesh-serve); the loader mounts it -- still in process. Proven on one small part.
2. The worker host and frame channel; one group of handlers in a worker; the measurements above.
3. Per-handler builds and the dependency maps.
4. One node per machine; placement kinds on contracts; anywhere contracts copied where they are hot.
5. Owned units with claims, fencing and leases.

Old-style parts (a `register.ts`) keep loading, in process, until each one moves.
