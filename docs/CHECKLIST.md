# Mesh: what's left before it stands on its own

Mesh is the framework (mesh, mesh-serve, mesh-web, mesh-web-kit), public one day and naming nothing
of SurfDNS. This is its own list, from the owner's questions of 2026-10-26. SurfDNS's work that
builds on it (streams.surfdns.net, the dashboards) is in company/architecture/design/streams-site.md.

## First: what the 10-26 reviews found (reports in company/ai/reviews/*-claude-2026-10-26.md)

Each checked against the code before listing.

- [ ] **mesh: one bad WebSocket frame crashes a node.** Inbound sockets have no `error` listener
      (`transports/node/WSTransport.ts:331-352`; outbound has one, `:836`); `ws` emits `error` on a
      frame it rejects, before the mesh key is checked. Anything reaching the mesh port kills the
      process. Add the listener and a `maxPayload`.
- [ ] **mesh-serve: an api token is not limited to its organization or roles.** `lookUpCaller`
      drops the token's `organizationId` (`api/gateway.ts:692-698`) and gates check the account's
      roles: a token acts with all its account's power, in every organization.
- [ ] **mesh-web: an effect that throws stops the rest of its update.** `flushPendingEffects`
      (`reactivity/context.ts:119-123`) clears the batch before running it and has no try per
      effect: one throw drops every effect after it (a duplicate key in `each()` freezes a list).
- [ ] **mesh-serve: an organization admin can delete the owner's membership** (raw
      `identity.membership.delete` public to admins, no hook) -- left with no owner.
- [ ] **mesh-serve: no secret is `hidden`** (`passwordHash`, token hashes); **mesh: update and
      replace events carry hidden fields** (the patch is not stripped).
- [ ] **mesh-serve: suspending an account or changing its password ends no session or token.**
- [ ] **mesh-web: a live list can show the previous user's or organization's rows** after a switch
      (events held during a fetch are not cleared).
- [ ] The rest of each report: registry records any peer can rewrite and request meta trusted as
      `ctx.meta`; dead-node calls wait the full timeout and timed-out calls never abort; `'one'`
      events on no node or every node; CRUD filters on hidden fields and `limit: 0`; stacks to remote
      callers; session roles not tied to their part; regex contract discovery; sites serving any
      build on any site; focus traps left behind; scopes and computeds never released; first
      stream subscriber hears events twice; props as attributes (`javascript:`, `on*`, style).
      Casts: mesh ~347 lines, mesh-serve 57 `as` + 36 `!`, mesh-web 49 `as` + 13 `!`.

## Dependencies (mesh's package.json)

Five do the work: zod, mongodb, ws, eventemitter3, zod-to-json-schema.

- [ ] **express out.** Used only by `core/UnifiedServer.ts` (never created: mesh-serve passes no
      `port` to NetworkModule) and `transports/node/HTTPTransport.ts` (used by nothing).
- [ ] **`UnifiedServer` removed** (dead; the last `as any` / `x!` code in mesh), with `MeshNetwork`'s
      `server` and `sharedServer` paths.
- [ ] **`HTTPTransport` and `TCPTransport`**: removed from `@flybyme/mesh/node`, or kept and tested.
      Nothing in mesh-serve or SurfDNS uses either.
- [ ] **dotenv, typescript, @types/node, @types/express, @types/ws to devDependencies.** dotenv is
      used by two test files only; the rest are build-time. Today every consumer installs them.
- [ ] **One test runner.** Mesh's own tests are jest; every other repo is vitest.

## Time series CRUD out

`defineTimeSeries` (MongoDB time series collections behind contracts) is used by nothing outside
mesh: no surfdns service defines one (checked 10-26; the console's `TimeSeriesChart` is
mesh-web-charts, unrelated). Metrics belong to the telemetry sink, not to a CRUD kind.

- [ ] **mesh:** `interfaces/ITimeSeriesContract.ts` (164 lines), `db/TimeSeriesRepository.ts` (161),
      `Database.tsRepo`, its paths in `DatabaseMiddleware.ts`, `ServiceBroker.ts`,
      `IServiceBroker.ts` and `IToolContract.ts`, the exports in `interfaces/index.ts` and `node.ts`,
      the demo's use (`examples/demo/demo.contract.ts`, `demo.service.ts`), `generated/api.ts`, and
      `__tests__/TimeSeries.spec.ts`.
- [ ] **mesh-serve:** the `defineTimeSeries` parsers in `cli/core/GenerateCommand.ts` (~414) and
      `cli/core/discoverPartContracts.ts` (~106).
- [ ] **docs:** `TIME_SERIES_CONTRACTS.md` removed; `DATABASE_INTEGRATION.md` (`tsRepo`) and
      `MIGRATION.md` (`defineTimeSeries` requirements) updated.

## Words: mesh says tenant

- [ ] **"organization" is mesh-serve's word, not mesh's.** In mesh core: the log field
      `organization` (`ServiceBroker.ts` `organizationOf`, on every handler's `ctx.logger`),
      `ISpan.organization`, and `Tenancy.ts` (`inOrganization`, the `organizationId` meta field it
      sets, "This call carries no organization"). Mesh says `tenant`; mesh-serve maps a tenant to
      its organization where it shows one.

## Telemetry: one pluggable sink (logs, spans, metrics)

The logger is replaceable and metrics and traces are pluggable; a node sends its own, nothing reads
it back off stdout. Mesh ships the plain sinks; whoever runs mesh plugs in where it goes (SurfDNS:
streams.surfdns.net).

- [ ] **A telemetry sink interface** in mesh: structured log records, spans, metric snapshots; any
      number installed; one that throws never fails the work it describes.
- [ ] **Structured log records.** The Logger's handler gets a formatted string today. A record: time,
      level, message, fields, error (message and stack), trace and span id, context.
- [ ] **Who wrote it, on every record.** Node id, part and version are on no line; the base logger's
      context is empty. Handler lines carry only contract and organization (`ServiceBroker.ts:643`).
- [ ] **A handler's unexpected error is logged** on the node that ran it, with its stack. Today a
      call's non-MeshError goes back to its caller only (an event listener's is logged,
      `ServiceBroker.ts:504`). Found 10-26: a 500 on infer left no line on any node.
- [ ] **Failed spans always reach the sinks;** every span when asked (`MESH_SPANS=1`). Today spans are
      all or nothing, one sink.
- [ ] **Metrics as data:** `MetricsRegistry.snapshot()` (series and values), not only Prometheus
      text. The `/metrics` page becomes one sink among others.
- [ ] **The plain sinks shipped with mesh:** text to stdout (today's default); Prometheus `/metrics`;
      a batching HTTP sink -- bounded buffer, one POST a second, drops counted past the cap, never
      slowing the node (`fetch`, so the same code in Node and the browser).
- [ ] **Flood control:** repeat suppression and a rate cap per call site. mesh-web has a repeat
      filter (`kernel/logs.ts`, `createRepeatFilter`); mesh has none.
- [ ] **Redaction:** a list of field names and values a sink strips (passwords, tokens). Nothing
      does today.
- [ ] **A node's level changed while it runs:** `setLevel` exists; no call reaches it.
- [ ] **`console.*` swept onto the logger:** 13 calls in mesh, 45 in mesh-serve (53 more in the
      surfdns services) bypass every sink.

## mesh-serve

- [ ] **Installs sinks from its configuration** (a module that exports one); nothing of SurfDNS.
- [ ] **The gateway writes one record per api request:** method, path, status, duration, tenant.
- [ ] **Part load, unload and deploy as records:** which part, which build, how long, heap before
      and after (the core out-of-memory of 2026-10-25 would have been one panel).
- [ ] **Revert a4235e4** (JSON to stdout, unreleased): replaced by the sink.
- [ ] **Four listeners per node** (mesh transport, api, sites, metrics): one server with routes, later,
      if the proxy and the Kubernetes services can address it.
- [ ] **Old modules freed on unload.** A reloaded part stays in memory: undici's global dispatcher
      holds the first build, `globalThis['mesh.globalCrudRegistry']` the latest (its crud hooks).
      CrudRegistry drops an owner's cruds on `unregisterOwner`.

## mesh-web

- [ ] **The same sink in the kernel:** the page's log records, spans for its calls, metrics (load
      timings, call durations). Default sink: the in-page buffer it has now.
- [ ] **A call's trace id goes to the server** in its meta, so one trace runs page -> gateway -> node.
- [ ] **Analytics as metrics:** page views (the route, not its parameters) and a visitor counted per
      day without a cookie, through the same sink.
