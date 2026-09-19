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
- **Collections it needs** -- resolved: not a bypass, a third first-class kind. `domain.find` /
  `domain.create` / etc. as registry-addressable `broker.call` targets are a shim -- the real
  dependency a contract has on its own data is "give me a scoped handle to collection X," not
  "route a call through the registry, middleware chain, and possibly a network hop to reach code
  that just calls `db.repo()` anyway." `whoami.ts`'s direct `db.repo()` read (flagged below as a
  bypass) is closer to the right shape than the generated `domain.find` contract is -- it's just
  missing the enforcement. **`Database.repo()` (`Database.ts:143`) returns a raw, unscoped
  `DomainRepository` -- verified directly: no `scopedBy` filtering, no `hidden`-field stripping, no
  event emission. All of that lives in `DatabaseMiddleware.ts`, wrapped *around* `repo()`, only on
  the `broker.call` path.** So a contract can't just be handed `db.repo()` on `ctx` -- that's
  `whoami.ts`'s bypass, not a fix for it. The injected handle has to be built the same way
  `DatabaseMiddleware` builds one today (scope-resolved from `ctx.meta`, `hidden` stripped, events
  still fired on write), just handed out per-declared-collection instead of triggered by a registry
  lookup.

  **Where the actual trust boundary is, verified directly:** `scopedBy`'s enforcement
  (`DatabaseMiddleware.ts:154-163`, `resolveCallerScope(ctx.meta, scopedBy)`) trusts whatever
  `ctx.meta` says -- it has no way to tell an authenticated value from a made-up one. Internally,
  nothing stops it being made up: `ServiceBroker.ts:778` merges `options?.meta` straight into the
  next context's meta on every `ctx.call`, unvalidated -- any in-mesh caller can pass
  `{ meta: { organizationId: 'someone-elses-org' } }` and `DatabaseMiddleware` will honor it. The
  *only* place `meta` gets built from something actually authenticated is `api.service.ts:406-443`
  (`handleRequest`): `caller` comes from `resolveCaller(req)` (the request's real ticket/token), and
  `meta.user.{id,tenant_id,organizationId}` are built from that plus the api's own hostname->tenant
  binding -- never from caller-supplied JSON. So `scopedBy` is a filter, not itself a gate; the api
  gateway is the one place in the whole system meta is actually trustworthy. Every other caller of a
  scoped contract -- another contract, the CLI, `sync.ts` -- is, today, on the honor system.

Two real complications, now resolved by treating collections as the third dependency kind:

1. Generic CRUD actions don't need a graph entry of their own (see above) -- they terminate the
   graph, they don't extend it with more code to load.
2. ~~Direct database access (the `whoami.ts` pattern) bypasses the graph entirely.~~ **Resolved
   above: it's not a bypass to disallow, it's the model -- once collections are a declared
   dependency kind with an enforced, injected handle instead of a raw `db.repo()` call.**

**Does a collection still need a registry-addressable contract for remote/cross-node access?
Resolved: no, not in general** -- same-process code gets the injected handle; there's no reason
`identity.user.find` needs to exist as a `broker.call` target just so code in the same node can
reach its own data. But **some scoped collections should still be reachable over the api** (e.g.
`GET /api/domains/:id`, tenant-scoped) -- that's `serve.expose`'s existing job (an operator's
explicit, per-api reachability decision, unchanged) and orthogonal to whether the mesh registry
carries the contract. And since the api gateway is already the one place `meta` is trustworthy
(above), and `mesh-serve start` already mounts `DatabaseModule` on every node today (`start.ts:81`
-- the whole current deployment model is one process holding everything, api included), an exposed,
scoped CRUD read doesn't need to round-trip through `ctx.call` -> registry -> middleware -> maybe a
network hop at all when the api and the data are co-located, which today they always are: the api
process can resolve `meta` from the request and read the collection directly through the same
injected-handle mechanism, skipping the mesh transport entirely for its own process's data. This
stops holding the moment api and data-owning roles genuinely split across processes -- at that point
it's back to a real call, local or not.

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
3. **Eviction -- resolved: CJS output + `require.cache` deletion, not worker_threads (for now).**
   `ServiceBroker.unregisterModule()` (`ServiceBroker.ts:509`) is thorough -- runs `onStop`, removes
   the module from `localTools`/`MeshToolSchemaRegistry`/`toolMountKeys`/`globalContractRegistry`,
   unregisters from the local `Registry` -- but it's bookkeeping only. It does **not**, and in plain
   Node/V8 *cannot*, unload an ES module (`import()`) from memory: tested directly (Node 22.22.1),
   re-importing the identical specifier always returns the same cached object, and there's no public
   `import.meta.cache` or equivalent to clear. CommonJS is different and was also tested directly:
   `delete require.cache[resolvedPath]` genuinely works -- a subsequent `require()` re-executes the
   file and returns a fresh object, and once nothing references the old one, V8 collects it like any
   other unreferenced object, no special-casing needed.

   So: on-demand contracts should build as CJS specifically (`runEsbuild`'s `format: 'esm'`,
   `build.ts:123`, is hardcoded -- adding a `format` parameter is trivial; esbuild bundles/rewrites
   everything from the entry point regardless of target format, so the choice is free at build time,
   no cost either way), loaded via `require()` (reachable from this codebase's ESM-throughout code
   via `createRequire`) instead of `import()`, specifically so they can be evicted for real via cache
   deletion. `long-running`/kernel/browser artifacts have no reason to change.

   One real caveat, downstream of the build, not the build itself: the external `@flybyme/mesh`
   dependency stays a bare `require('@flybyme/mesh')` in CJS output either way (`external` means
   esbuild leaves the reference alone, regardless of format) -- and `@flybyme/mesh`'s own package is
   ESM-only. Tested directly against the real installed package: `require('@flybyme/mesh')` **does**
   work, but only because Node 22 added synchronous `require()`-of-ESM support -- version-sensitive,
   not guaranteed on whatever Node version the cluster actually deploys on (`runEsbuild` targets
   `node20`). Confirm the real deployed Node version before relying on this, the same class of gap
   that broke `tsx`'s own resolution of this exact package earlier the same day this doc was written.

   worker_threads remains the answer if/when true isolation (crash containment, not just memory)
   becomes a real, measured need -- not the starting point.
4. **`ctx.signal` needs to become real.** `IServiceContext` already declares `readonly signal?:
   AbortSignal` (`IServiceContext.ts:51`) -- but verified directly: neither place that builds the
   object handlers actually receive (`ServiceBroker.ts:392` and `:455`, the two `serviceCtx`
   literals inside `registerModule`) sets it, and the internal `IContext` those are built from
   (`ServiceBroker.ts:773`, `:818`) has no abort-related field either. There is no `AbortController`
   anywhere in the broker. Every handler in the codebase can read `ctx.signal` today; it is always
   `undefined`. Same shape of gap as eviction was before this section: declared, never wired.

   This starts to matter for real once eviction (above) is real: a `long-running` handler that's
   about to be evicted (or just past its call's own timeout, which already exists as a race against
   `resultPromise` at `ServiceBroker.ts:793-797` but only ever rejects the *caller*, never signals
   the *handler*) needs a way to be told to stop, so it can leave `require.cache` deletion pointing
   at something with no in-flight work still touching it, instead of racing eviction against a
   handler that's still running. Wiring this is: construct one `AbortController` per call, hand
   `.signal` to both `serviceCtx` literals, call `.abort()` on the existing timeout path instead of
   only rejecting, and call `.abort()` again from whatever eventually drives eviction. No handler is
   obligated to observe it (same as any other `AbortSignal` in Node) -- but today none even *can*.

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
- ~~What does a generic CRUD-generated contract's `filePath`/`concurrency` look like~~ **Resolved:
  `defineCrud` gains its own required `filePath`** (same explicit-required discipline `dependencies`
  already has -- `ICrudContract.ts:378-382`), forwarded into all ten `defineContract` calls it makes
  internally; `concurrency` is hardcoded to `on-demand` for all of them, never asked, since a CRUD
  verb is call-and-return by construction. Not a synthetic/lying value: for a CRUD collection,
  `filePath` genuinely is the file that calls `defineCrud(...)`, because importing that file is what
  registers the schema `DatabaseMiddleware` (already loaded everywhere) needs to serve it -- the same
  "code that has to load" question `filePath` answers for a hand-written contract. **Still open:**
  `permissions` doesn't resolve this easily -- `visibility`/`destructive` are already per-action on
  `defineCrud` (`find` and `delete` on the same collection are very different blast radii), so
  `permissions` likely needs to be per-action too, not one value for the whole collection.
- **CRUD as a `broker.call` target is a shim over `db.repo()` -- resolved to drop it as the primary
  path.** See "Proposed: dependency graph" above: collections become a declared dependency kind with
  an injected, scoped handle on `ctx`, not a registry-addressable contract, for same-process access.
  `serve.expose` still decides per-api whether a scoped collection is reachable over the api at all --
  unchanged, orthogonal. **Still open:** the exact shape of the injected handle/API (`ctx.db(domain)`?
  something typed per declared collection?) and whether `defineCrud` needs to keep generating its ten
  `defineContract`s at all once same-process callers stop using them, or only for the api-exposed
  subset.

## Checklist

- [ ] `filePath` on `defineContract` -- **required**, throws if omitted
- [ ] `concurrency` (`on-demand` / `long-running` / `interval`) on `defineContract` -- **required**,
      throws if omitted, no default
- [ ] `permissions` on `defineContract` -- **required**, throws if omitted (explicit "none"/public
      still has to be stated)
- [ ] `scopedBy` generalized from `defineCrud` to `defineContract` -- optional, the one exception
- [x] `filePath`/`concurrency` for CRUD-generated contracts -- resolved: `defineCrud` gains a
      required `filePath`, forwards it plus a hardcoded `on-demand` into all ten generated
      `defineContract` calls (see open forks)
- [ ] `permissions` for CRUD-generated contracts -- likely per-action like `visibility`/`destructive`
      already are, not one value for the whole collection (still open, see forks)
- [ ] **Migrate every existing `defineContract` call site, in every repo**, to supply the three
      required fields -- this is not optional follow-up work, it's the thing that makes the change
      land at all. Every contract in `mesh`, `mesh-serve`, `mesh-web`, `mesh-core`, and every
      `surfdns-*` service stops loading the moment this ships without it.
- [ ] Dependency-graph tracking: contracts called, methods required, and collections needed as three
      distinct declared kinds, not one
- [x] Direct-database-access tools bypassing the graph -- resolved: not a bypass, the model. See
      "collections it needs" above.
- [ ] Design the injected scoped-collection handle itself (`ctx.db(domain)` or similar) -- has to
      replicate what `DatabaseMiddleware` enforces today (`scopedBy` resolution, `hidden`-field
      stripping, event emission on write), not just wrap raw `Database.repo()`
- [ ] Decide whether `defineCrud` still generates all ten `broker.call`-addressable contracts
      unconditionally, or only the subset an api actually exposes (`serve.expose`) -- same-process
      callers no longer need them once the injected handle exists
- [ ] Wire the api-colocated fast path: when a scoped, exposed collection's data lives on the same
      node as the api handling the request (true today -- `start.ts` mounts `DatabaseModule` on every
      node), read it directly through the injected handle using the api's own resolved `meta`, instead
      of round-tripping through `ctx.call` -> registry -> middleware
- [ ] Wire `ctx.signal` for real: one `AbortController` per call, passed into both `serviceCtx`
      literals (`ServiceBroker.ts:392`, `:455`), `.abort()`'d on the existing timeout race and on
      eviction -- currently declared on `IServiceContext` and always `undefined` in practice
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
- [ ] Eviction -- **resolved**: build on-demand contracts as CJS (`format` param on `runEsbuild`),
      load via `require()`, evict via `delete require.cache[path]`. Confirm the real deployed Node
      version supports `require()`-of-ESM before relying on it for the external `@flybyme/mesh` ref
- [ ] Resolve the remaining open forks above before or during implementation, not after
