# Contract-Driven Placement

Status: **proposal / design thinking, not implemented.** Nothing described here exists yet. This
document exists to hold the idea together across sessions, not to describe current behavior --
see [SERVICE_BROKER_AND_CONTRACTS.md](./SERVICE_BROKER_AND_CONTRACTS.md) for what's real today.

## The thesis

A `broker.call('identity.whoami', ...)` is already location-transparent for the *caller* -- you
never say which node answers it, the registry finds whoever can. The code that actually answers it
is not: it only runs wherever the `ServiceModule` that happened to mount it is a running process.
That's an artifact of how code is packaged (bundled into a `ServiceModule`, which is also the unit
that decides *when* it runs, via `onStart`), not a real constraint on the work itself.

Most tool code is a pure function: given input, maybe call a few other contracts, return output.
Nothing about that requires a permanently-running process sitting somewhere waiting for it -- it
could be loaded on demand, anywhere in the cluster with capacity, the same way a CRUD call already
runs on whichever node happens to own the request, because there's one database across every node
and nothing node-specific to load. The interesting case -- and the only case that actually needs a
persistent process -- is code with a genuine reason to live somewhere specific, continuously: a
real listener bound to a port, a stateful singleton, a self-triggered timer.

`ServiceModule` currently is the container for *all* code, not just that case. This document is
about giving contracts enough self-declared metadata that the system can tell the two apart, and
eventually place/schedule code accordingly -- instead of a person deciding, once, by hand, which
process a piece of code lives in forever.

## Motivating context

This came out of a session that spent a full day getting `mesh-serve` itself bootstrapped
end-to-end (roles, a real first-claim account, a CLI, `sync.ts` provisioning a site's repos/parts/
composition/release/deploy by hand). That work made obvious how much of it is manual stitching --
`sync.ts` is a step-by-step script because nothing in the system already knows how its own pieces
fit together. And `mesh-serve` itself is a small fraction of what's actually being built (the real
product is the collection of services -- DNS, mail, git hosting, etc. -- that `mesh-serve` exists to
host); the bootstrapping work was necessary scaffolding, not the main show.

## What's already true today (verified, not assumed)

- A contract's **schema** is already portable without its implementation: `serve.api.generateClient`
  produces a fully-typed client from `defineContract`'s metadata alone; a caller never needs the
  service code that answers it.
- `destructive: true` on a contract is already **intrinsic** metadata other code (hold-service's
  agent-freeze logic) trusts unconditionally, regardless of where/how the contract is reached --
  the precedent for putting more self-description directly on the contract.
- `scopedBy` (tenant/org/user isolation, enforced automatically by `DatabaseMiddleware`) exists
  **only** on `defineCrud` today, not on plain `defineContract`.
- **`resolve`/`find`/`get`/`count`/etc. are generic, framework-owned CRUD actions** --
  `ICrudContract.ts:306/468/598` -- with no domain-specific file at all. Traced
  `identity.whoami` (mesh-serve) as a concrete example: it calls `identity.user.resolve` and
  `identity.organization.resolve`, neither of which has custom code to load -- they're `mesh`'s own
  universal executor, driven purely by schema. A "where does this code live" field would be
  meaningless for these; they're already exactly what this document is trying to make *other* code
  become: placeable anywhere, nothing to load.
- **Some tool code reaches the database directly, bypassing the contract layer entirely.**
  `whoami.ts` does a raw `db.repo(...).find(...)` instead of a scoped contract call, specifically
  because the scoped version couldn't do what it needed. This is invisible to any dependency graph
  built from contract-call tracing alone -- a real gap this design has to account for, not paper
  over.

## Proposed: new `defineContract` metadata

**Decided: breaking, not additive.** `filePath`, `concurrency`, and `permissions` are **required**
-- `defineContract` throws if any of the three is omitted. `scopedBy` is the one exception and
stays optional, the same as it is on `defineCrud` today (not every contract needs tenant/org/user
scoping; plenty are legitimately global). This resolves the "incremental vs. breaking" fork below
in favor of breaking: every existing `defineContract` call site, in every repo, has to be updated
with real values for these three before its contracts can load again. There is no compatibility
shim, no default-and-warn -- an omitted field is a startup failure, not a lint warning.

- **`filePath`** (required) -- where the implementing code lives. Only meaningful for genuinely
  custom tools; generic CRUD actions need none (see above) -- how a CRUD-generated contract
  satisfies this requirement, if at all, is still open (see forks).
- **`concurrency`** (required, runtime nature) -- one of:
  - `on-demand`: call-and-return, placeable anywhere, loaded only when needed.
  - `long-running`: needs a port/host binding, must live somewhere specific and stay there.
  - `interval` / `timer`: self-scheduled, no caller at all.
  - No default -- every contract states its own nature explicitly, on purpose: a silent default of
    `on-demand` would be exactly the kind of unstated assumption this whole design exists to remove.
- **`permissions`** (required) -- an intrinsic required-role baseline, parallel to `destructive`.
  An intentionally public contract still has to say so explicitly (e.g. an empty/`none` value),
  not simply omit the field.
- **`scopedBy`** (optional) -- generalized from `defineCrud` so a plain contract *can* get the same
  automatic scope-resolution/enforcement a CRUD collection already gets, when it needs it.

## Proposed: dependency graph

A way to know, per contract, what it depends on -- currently invisible, discoverable only by
reading source. Two genuinely different kinds of dependency, not one:

- **Contracts it calls** (`ctx.call('other.domain.action', ...)`) -- live, addressable, resolved by
  the broker/registry at call time, possibly on a different node entirely. This is the graph edge
  that decides *what else* has to be reachable, not loaded.
- **Methods it requires** -- plain shared code with no `domain.action` identity: not mountable, not
  callable via `broker.call`, nothing the registry has ever heard of. Already real and widely used,
  just never declared: `src/identity/methods/hash.js` (`hashPassword`), `src/identity/methods/
  roles.js` (`matchesContract`, `resolveEffectiveRoleKeys`), `src/catalog/methods/release.js`
  (`computeReleaseHash`), `src/api/methods/descriptor.js` -- every domain in `mesh-serve` already
  has one of these folders. A method has no independent placement of its own; it's always bundled
  and loaded wherever the contract that requires it gets placed, never scheduled on its own.

Two real complications to solve, not ignore:

1. Generic CRUD actions don't need a graph entry of their own (see above) -- they terminate the
   graph, they don't extend it with more code to load.
2. Direct database access (the `whoami.ts` pattern) bypasses the graph entirely -- a *third*, unruly
   kind of dependency that's neither a contract call nor a declared method. Either disallow it
   (force every real dependency through a contract call the graph can see), or give a tool its own
   way to declare "I also touch collection X" so the graph stays honest even when a tool needs to
   step outside the contract layer.

## Proposed: a new `kind` -- replaces `service`, not alongside it

`serve.part`'s `kind` enum (`kernel | application | extension | driver | theme | service`) has no
slot for "one on-demand function, no process required." Since `ServiceModule` is dropped (above),
`service` as a `kind` goes with it -- there's no more "a service, as opposed to this new thing";
the new kind, one contract/one file/one declared runtime nature, *is* what every current `service`
part becomes. `kernel | application | extension | driver | theme` are untouched -- they're about
mesh-web's own browser-side composition, a different axis entirely from what this document changes.

## `ServiceModule` is dropped

Not narrowed -- dropped. Checked every current mesh-serve service's actual instance state before
deciding this, not just reasoned about it abstractly:

- `IdentityService`, `HoldService`: **zero** instance state. Every tool is already a fully
  independent, on-demand function.
- `CatalogService`: one `watchInterval` -- exactly the proposed `interval` concurrency kind, scoped
  to one piece of functionality (`watchRelease`), not shared with catalog's other, stateless tools.
- `QueueService`: one `timer` + one `inFlight` set -- same shape, real state, entirely owned by the
  tick loop, not shared with the rest of queue's tools.
- `ApiService`, `CdnService`: the only two with a real listener + meaningful state
  (`CdnService.webRequestCache`) -- but even here, everything is scoped to *one* cohesive thing (a
  gateway that dispatches to the rest of the system), not a bag of otherwise-unrelated tools that
  happen to share a class.

Every real case of "this needs to persist/hold state" in the current codebase is already naturally
scoped to exactly one atomic unit. Nowhere does `ServiceModule`'s actual distinguishing feature --
grouping *several* tools to share *one* process's state -- do real work; it's just where the code
happens to live. So: every contract stands alone and declares its own `concurrency`. `on-demand`
contracts are placed and loaded per call, same as CRUD. `long-running`/`interval` contracts are
exactly what they are today -- one cohesive piece of code with its own private state and methods --
except the scheduler owns starting/stopping them, not a hand-written class wrapping `onStart`/
`onStop`.

**Known gap, not a blocker:** nothing in the current codebase needs two *different* contracts to
share one resource (e.g. two message types on the same open socket). If that need shows up for
real, it needs an answer this document doesn't have yet -- but nothing today actually requires it,
so it isn't blocking the decision to drop `ServiceModule`.

## Proposed: a placement/scheduling layer

Given a contract's declared `filePath`/`concurrency`/`scopedBy`/dependency graph, and a live
registry of nodes and their capacity, something has to actually decide where to load and run code
on demand -- and, separately, where a `long-running`/`interval` contract lives persistently once
claimed. Smaller than it first looked: most of the actual mechanism already exists in `mesh` today,
just not wired to trigger automatically.

### What actually loads a `ServiceModule` today

Traced it precisely, not assumed. **Nothing dynamic happens at all.** `start.ts` statically
`import`s the class and does `new IdentityService()` -- fully constructed in memory before the
process even starts. `ServiceBroker.registerModule()` (`ServiceBroker.ts:340`) never touches the
filesystem or does an `import()` of any kind; it takes an already-built object and wires it into
`this.localTools` (the in-process dispatch table), registers its schemas, and tells the local
`Registry` about it. "Loading" today means, exactly and only, "was hardcoded into `start.ts` and
resolved at build time."

### The dynamic-load mechanism already exists -- it's `startService.ts`

`mesh-serve`'s `src/catalog/tools/startService.ts:53,63` (the exact file this session fixed a real
`tsx`/module-resolution bug in) already does:

```
const imported = await import(pathToFileURL(absolutePath).href);
...
await ctx.broker.registerModule(instance);
```

A real, working, **runtime** dynamic module load, on a node that's already been running, triggered
today by an explicit `serve.part.start` call. This already is the on-demand loading mechanism --
it just needs to fire automatically instead of only on an explicit operator command.

### Leader-based routing already exists too

`ServiceBroker.ts:430`: `if (contract.leaderScoped === true)`, a call checks `leaderFor(domain)`
(`Registry.ts:604` -- deterministic, no election, every node computes the same answer from the same
membership data) and forwards via `callOnLeader` if the current node isn't the leader. The *routing*
half of the `long-running`/singleton case is already built. What's missing is the trigger that makes
a newly-elected leader actually *start* the code the first time -- `leaderFor` is a pure computed
function with no change event; nothing today notices "I just became the leader for X" and reacts.

### What's genuinely new, then -- smaller scope than it looked

1. `ServiceBroker.call()`'s existing `if (endpoint)` branch (where `selectNode` came back empty,
   around `ServiceBroker.ts:752-762`) needs a fallback: look up the contract's declared `filePath`,
   pick a node, trigger the same `import()` -> `registerModule()` sequence `startService.ts` already
   proves out, then retry -- automatically, not only via an explicit command.
2. Something needs to watch for leadership changes (polling `leaderFor`, or reacting to whatever
   membership-change events the `Registry` already emits as nodes join/leave) and run that same
   load sequence once, the first time a node becomes leader for a `long-running`/`interval` domain
   it doesn't have loaded yet.
3. **Eviction is bookkeeping-only, not true memory reclamation.** `ServiceBroker.unregisterModule()`
   (`ServiceBroker.ts:509`) already exists and is thorough -- runs `onStop`, removes the module from
   `localTools`/`MeshToolSchemaRegistry`/`toolMountKeys`/`globalContractRegistry`, unregisters from
   the local `Registry`. It does **not**, and in plain Node/V8 *cannot*, actually unload the imported
   ES module from the process's memory -- `import()` has no matching "forget this module" primitive
   without something heavier (a `vm.Module` in an isolated context, a worker thread that gets torn
   down entirely). An "evicted" on-demand contract stops being routable and stops being called, but
   its code and any module-level state stay resident until the whole process exits. Worth deciding
   deliberately whether that's acceptable (probably fine for small, stateless tools) or whether truly
   memory-bounded eviction needs process/worker-level isolation, which is a much bigger addition.

## Open forks -- real decisions, not details

- **Intrinsic vs. extrinsic permissions.** Does a contract's declared `permissions` become the one
  true authority everywhere it's ever exposed, or a floor a per-api `serve.expose` row can still
  tighten but never loosen below? The current model (`serve.expose.add({apiId, contract, role})`)
  is deliberately extrinsic -- the same contract can be exposed with different roles, or none, on
  different apis. Baking a role into the contract itself is a real behavior change, not just added
  documentation.
- ~~Does the new atomic-code kind coexist with `service` long-term~~ **Resolved: no `service` kind,
  no `ServiceModule`.** Every real current use of persistent state/listeners was checked and is
  already scoped to one atomic unit (see above) -- there's nothing left for `service` to be the
  *other* option to.
- **Who owns the scheduler** -- a new capability inside `mesh` core itself, or something layered on
  top in `mesh-serve`?
- ~~Incremental vs. breaking~~ **Resolved: breaking.** `filePath`/`concurrency`/`permissions` are
  required and `defineContract` throws without them (see above). This means the migration itself is
  now a real, upfront piece of work, not an optional follow-on -- see the checklist.
- **What does a generic CRUD-generated contract's `filePath`/`concurrency` look like**, now that
  `filePath` is required but generic actions genuinely have no domain-specific file? Does `defineCrud`
  supply a synthetic value for these ("this action's code is `mesh` itself") so the requirement is
  satisfiable without lying, or does the requirement only apply to `defineContract` calls that aren't
  CRUD-generated in the first place?

## Checklist

- [ ] `filePath` on `defineContract` -- **required**, throws if omitted
- [ ] `concurrency` (`on-demand` / `long-running` / `interval`) on `defineContract` -- **required**,
      throws if omitted, no default
- [ ] `permissions` on `defineContract` -- **required**, throws if omitted (explicit "none"/public
      still has to be stated)
- [ ] `scopedBy` generalized from `defineCrud` to `defineContract` -- optional, the one exception
- [ ] Resolve how CRUD-generated contracts satisfy the `filePath`/`concurrency` requirement (open
      fork above) -- blocks the next item, since `defineCrud` calls `defineContract` internally
- [ ] **Migrate every existing `defineContract` call site, in every repo**, to supply the three
      required fields -- this is not optional follow-up work, it's the thing that makes the change
      land at all. Every contract in `mesh`, `mesh-serve`, `mesh-web`, `mesh-core`, and every
      `surfdns-*` service stops loading the moment this ships without it.
- [ ] Dependency-graph tracking: contracts called (live, addressable) and methods required (plain
      shared code, no address, always co-loaded) as two distinct declared kinds, not one
- [ ] A resolution for direct-database-access tools bypassing the graph
- [ ] New `kind` for one atomic piece of code -- **replaces** `service`, not added alongside it
- [ ] **Drop `ServiceModule` and `kind: 'service'` entirely.** Migrate every current `ServiceModule`
      subclass (`mesh-serve`: `IdentityService`, `CdnService`, `CatalogService`, `HoldService`,
      `QueueService`, `ApiService`, and any in `surfdns-*`) to the new kind -- most (identity, hold,
      and catalog/queue's non-timer tools) become plain on-demand contracts with no wrapper at all;
      `ApiService`/`CdnService`, and catalog/queue's own timers, become `long-running`/`interval`
      contracts, each one cohesive unit, not a class grouping several
- [ ] `ServiceBroker.call()`'s empty-`selectNode`-result fallback: on-demand `import()` +
      `registerModule()`, reusing the exact sequence `startService.ts` already proves out
- [ ] A leadership-change watcher that triggers the same load sequence once, for `long-running`/
      `interval` domains a node newly becomes leader for
- [ ] Decide eviction policy given it's bookkeeping-only (`unregisterModule` stops routing, does not
      free memory) -- accept that for small/stateless on-demand contracts, or scope real
      process/worker-level isolation as a separate, bigger piece of work
- [ ] Resolve the remaining open forks above before or during implementation, not after
