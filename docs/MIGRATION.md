# Migrating a service to contract-driven placement

For a repo built on `@flybyme/mesh` that still defines services as `ServiceModule` subclasses.
`mesh-serve` has already done this, completely -- there is no `*.service.ts` left in it -- so every
pattern below has a working example to copy rather than a description to interpret.

Read `CONTRACT_DRIVEN_PLACEMENT.md` for why any of this is shaped the way it is. This file is the
how.

---

## 1. What breaks immediately

These throw at import time, so the repo will not start until they are fixed. That is deliberate:
a silent default is the thing the whole design is trying to remove.

**`defineContract` requires three new fields.**

```ts
filePath: 'src/billing/tools/charge.ts',   // the module that IMPLEMENTS it -- see trap 1
concurrency: 'on-demand',                   // 'on-demand' | 'long-running' | 'interval'
permissions: [],                            // role keys; [] means "no intrinsic requirement"
```

**`defineCrud` and `defineTimeSeries` require `filePath` and `permissions`.** For a CRUD collection
`filePath` genuinely is the file that called `defineCrud` -- importing it is what registers the
schema that serves it, and there is no per-action handler.

**`concurrency: 'interval'` requires `intervalMs`**, and `intervalMs` on anything else throws. A
period the runtime would ignore is how an hour of "why isn't this running" starts.

**`ctx.signal` is no longer optional.** Anything constructing an `IServiceContext` by hand (test
helpers, mocks) must supply one. `new AbortController().signal` is fine for a mock.

**`RegistryModule` refuses a `ttl` below 15000ms.** If the repo passes `ttl: 5000`, delete the
option and take the 30000 default -- see trap 3.

---

## 2. What to do with the service class

A `ServiceModule` did three unrelated jobs: it *grouped* contracts, *held* state, and *owned* a
lifecycle. Only the middle one is ever real. Take them apart in this order.

### 2.1 Point every contract at its handler

Before anything else, make `filePath` true. Nothing works until it is, and nothing catches it
because until now nothing read the field.

```ts
// before -- points at itself, which tells a loader nothing
filePath: 'src/billing/contracts/invoice.contract.ts',

// after
filePath: 'src/billing/tools/charge.ts',
```

### 2.2 Handlers become plain functions

Drop `this: SomeService` annotations -- they are dead the moment the class is gone. If a handler
used `this.someMethod()`, move that method to a module the handler imports.

Reference: `mesh-serve/src/hold/tools/decide.ts`.

### 2.3 A timer becomes an `interval` contract

Delete the `timer` field, the `setInterval` in `onStart`, the `clearInterval` in `onStop`, and any
hand-rolled guard against overlapping ticks. Declare the period; the broker owns the timer and
skips a tick that is still running.

```ts
concurrency: 'interval',
intervalMs: 500,
leaderScoped: true,   // only if it must run on exactly ONE node -- see 2.6
```

Reference: `mesh-serve/src/queue/tools/tick.ts` and its contract.

### 2.4 A listener becomes a `long-running` contract

The handler starts the resource, hands teardown to `ctx.signal`, and returns. There is no
`onStop`, and nothing holds the server but that closure.

```ts
export async function listen(params: ListenInput, ctx: IServiceContext): Promise<ListenOutput> {
    const server = http.createServer(app).listen(params.port);
    ctx.signal.addEventListener('abort', () => server.close(), { once: true });
    if (ctx.signal.aborted) server.close();   // aborted between bind and here
    return { boundTo: params.port, nodeID: ctx.nodeID };
}
```

For a `long-running` contract `ctx.signal` is scoped to the *registration*, not the call -- it
stays live after the handler returns and aborts once, when the contract is unregistered or the
node stops. That abort **is** the stop.

Reference: `mesh-serve/src/cdn/tools/listen.ts` (32 lines, including the comments).

### 2.5 Real state stays in a class -- just not that one

Dropping `ServiceModule` is not about banning classes. It is about removing the *tool-grouping*
one. If the service owns a genuinely cohesive resource (an HTTP server and its request handling, a
connection pool), keep it as a plain class that holds **no contracts**, constructed by the
long-running contract's handler.

Per-node state that merely outlives a call (an in-flight set, a cache) can go to module scope: a
part is `require()`d once per node, so module scope has exactly the lifetime the instance had.

Reference: `mesh-serve/src/cdn/gateway.ts` -- 684 lines of unchanged request handling, zero
contracts on it.

### 2.6 `leaderScoped` if and only if it must be a singleton

`leaderScoped` on an `interval` contract makes it a cluster singleton: every node loads it, only
the leader ticks, re-checked every tick. Use it when concurrent runs would be wrong -- a sweep
that reads-then-writes without a precondition is wrong with two nodes even if it looks idempotent.

Do **not** use it for something every node should do (its own HTTP listener, its own worker loop).

### 2.7 CRUD hooks move onto `defineCrud`

```ts
defineCrud('billing.invoice', invoiceSchema, {
    hooks: {
        create: {
            before: async (input: never, ctx: never) => { /* validate, enrich */ return input; },
        },
    },
    ...
});
```

Declared on the collection, so it holds wherever the collection is mounted rather than depending on
a registration site remembering to pass it.

### 2.8 Seeding does not belong at load time

If `onStart` wrote to the database -- seeding roles, ensuring a row exists -- that is **not** load
work. Loading a part must not mutate shared cluster state, because loading is per node: five nodes
starting means five racing seed loops. Make it an ordinary contract and have whatever owns
first-boot call it once.

Reference: `mesh-serve/src/identity/tools/ensureBuiltins.ts`.

### 2.9 Delete the class and the registration file

Contracts are mounted by `broker.loadDomain(domain, handlers?, { resolve })`, which reads the
domain's contracts out of `globalContractRegistry` and wires each one by what it declares --
`isCrud` needs no handler, `long-running` is registered *and called*, `interval` self-starts.

Two ways to give it handlers, and a repo usually needs both:

- **Unbundled** (running from source or `dist/`): the modules really are at the declared paths, so
  a resolver imports them. `@flybyme/mesh/node` ships it -- the whole binding is six lines:

  ```ts
  import path from 'node:path';
  import { fileURLToPath } from 'node:url';
  import { createHandlerResolver, findPackageRoot } from '@flybyme/mesh/node';

  const root = findPackageRoot(path.dirname(fileURLToPath(import.meta.url)));
  export const resolveHandler = createHandlerResolver({ root, load: (url) => import(url) });
  ```

  **Pass `load` from your own package.** It looks redundant and is not: under tsx or vitest only
  modules that runtime owns get transformed, so the identical `import()` made from inside
  `node_modules` refuses a `.ts` handler with "Unknown file extension". See
  `mesh-serve/src/catalog/methods/resolveHandler.ts`.
- **Bundled** (one `.cjs` per part): there are no separate modules left inside the bundle, so the
  map is built at build time. Copy the pattern in `mesh-serve/src/cli/core/buildCoreParts.ts` and
  `discoverPartContracts.ts`.

If the repo does not bundle, it only needs the resolver.

---

## 3. Traps that cost real time

**1. `filePath` pointing at the contract's own file.** It was wrong in 48 of 50 contracts in
mesh-serve, because nothing read it. Now things do. Add the check:
`mesh-serve/test/unit/contracts/filePath.test.ts` fails the build on any `defineContract` whose
`filePath` ends in `.contract.ts`.

**2. `instanceof MeshError` across a part boundary.** A node loads `@flybyme/mesh` through the ESM
loader for its own imports and again through `require()` when it loads a precompiled part -- under
`tsx` those are two distinct copies, so `instanceof` answers `false` for a genuine `MeshError` and
every meaningful status silently becomes a 500. Use `isMeshError(err)`. This is not theoretical and
it is not obvious: it cost three rounds of fixing correct-but-unrelated things.

Anything that must be recognized across a part boundary needs a structural check, never a class
identity.

**3. `RegistryModule({ ttl })` below the presence interval.** Presence broadcasts every 15s, so a
ttl under that marks every peer offline for most of each cycle. It looks perfectly fine on one node
and only appears when two run together, as calls failing "no node advertises this domain". The
module now refuses it outright.

**4. Per-node state keyed without the node.** Any module-level registry of "what this node is
running" must include the node id in the key. One process hosting two brokers is a real case (any
multi-node test), and without it the second node is told a part is already running because the
first loaded it.

**5. Ports read from `process.env` at listen time.** Fine with one node per process, wrong with two
in one process: the env is shared and load order decides who binds what. Accept the port as a
contract parameter where it matters.

**6. A `long-running` contract cannot be demand-loaded.** The demand arrives through the thing that
isn't running -- an HTTP request cannot start the HTTP server. `on-demand` contracts are pulled
into existence by the first call; `long-running` and `interval` must be *pushed* by a decision
(a CLI flag, a bootstrap step, the supervisor).

**7. Duplicate contract keys.** `ServiceModule.mountTool` used a plain map, so two contracts
claiming one key were resolved silently by last-write-wins. `registerContract` refuses instead.
Expect to find at least one real collision; fix it by renaming the generated action
(`defineCrud`'s `actions` option) rather than by passing `{ replace: true }`.

**8. `import()` performed from the wrong package.** Under tsx or vitest, only modules that runtime
owns get transformed. A dynamic `import()` of a `.ts` file executed from inside `node_modules` is
outside that graph and fails with "Unknown file extension .ts", while the identical call written in
your own package works. This is why `createHandlerResolver` takes a `load` option instead of
importing for you. It generalises: **any module loading you delegate to a library has to be handed
back your own importer** if the target might be TypeScript.

---

## 4. Verifying it

In this order. Each step catches a class the previous one cannot.

1. **`tsc --noEmit`** -- the required-field throws are runtime, but most call-site breakage is not.
2. **The repo's own tests.** Expect the duplicate-key refusal and the `ctx.signal` requirement to
   surface here.
3. **A single node, started for real**, doing whatever it normally does. Confirms loading,
   listeners binding, timers running.
4. **Two nodes.** This is not optional, and it is where the interesting bugs are. Every bug in the
   list above except 1 and 7 was invisible to every single-node test. The specific check worth
   making: take an error a handler throws -- a 404 for a missing row -- and confirm it comes back
   as **the same status through both nodes**, one where the handler is local and one where it is
   remote. That single assertion catches traps 2 and 3 together.

---

## 5. What not to change

- **Don't delete `ServiceModule` from `mesh`.** It is still exported and still supported; other
  repos depend on it. The loader accepts both shapes precisely so services migrate one at a time.
- **Don't migrate behaviour while migrating shape.** Move the code, keep it identical, verify, and
  make behavioural changes as separate commits. The exception is a bug the migration exposes --
  fix it, but say so.
- **Don't touch other repos.** One repo per migration.
