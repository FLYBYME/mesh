# Mesh: what's left before it stands on its own

Mesh is the framework (mesh, mesh-serve, mesh-web, mesh-web-kit), public one day and naming nothing
of SurfDNS. This is its own list (owner, 2026-10-26). What SurfDNS builds on it is elsewhere:
streams.surfdns.net in company/architecture/design/streams-site.md, the service repos' review
findings in company/architecture/open.md. Review reports: company/ai/reviews/*-2026-10-26.md.

## 1. Security and correctness first (10-26 reviews, checked against the code)

**mesh**
- [ ] **One bad WebSocket frame crashes a node.** Inbound sockets have no `error` listener
      (`transports/node/WSTransport.ts:331-352`; outbound has one, `:836`); `ws` emits `error` on a
      frame it rejects, before the mesh key is checked. Add the listener and a `maxPayload`.
- [ ] **A peer is trusted too far:** its REQUEST meta becomes `ctx.meta` (a peer can call as any
      tenant), and it can rewrite another node's registry record.
- [ ] **Hidden fields leak in events:** `updated` and `replaced` carry the patch unstripped.
- [ ] **CRUD `query` takes any Mongo operator** (a filter on a hidden field guesses it character by
      character) and `limit: 0` returns everything: an operator allowlist and a cap.
- [ ] **Errors:** a network handler that throws is an unhandled rejection; a remote caller gets the
      handler's stack and internal messages; an unparseable frame is dropped with no log.
- [ ] **Calls:** to a gone node, they wait the whole timeout; a timed-out call never aborts
      `ctx.signal`; `replace: true` on a long-running contract leaves the old timer ticking.
- [ ] **`delivery: 'one'`** events can run on no node or on every node.
- [ ] **Unbounded maps and timers** per node id or URL ever seen (redials, presence, peer metadata).
- [ ] **Event definitions** never update or leave: the first registration wins.

**mesh-serve**
- [ ] **An api token is not limited to its organization or roles.** `lookUpCaller` drops the
      token's `organizationId` (`api/gateway.ts:692-698`); gates check the account's roles.
- [ ] **An organization admin can delete the owner's membership** (raw `identity.membership.delete`
      public to admins, no hook).
- [ ] **No secret is `hidden`:** `passwordHash`, `apiToken.tokenHash`, `ticket.token`, `userToken.tokenHash`.
- [ ] **Suspending an account or changing its password ends no session or api token.**
- [ ] **A part's session role is not tied to the part that issued it;** every unknown bearer token
      goes to every `session_validate`, and their errors are dropped.
- [ ] **Two parts on one build:** a failed second load unregisters the first, which stays "running".
- [ ] **The sites server** serves any build's files on any site, and its pages can be framed.
- [ ] **Contract discovery by regex** drops contracts and can bind the wrong handler.

**mesh-web** (v0.21.26 fixed six: a throwing effect, duplicate `each()` keys, events held across a
user switch, `on*`/`srcdoc`/`javascript:` props, a dialog's trap on route change, the first stream
subscriber's double events)
- [ ] **Never released:** disposed scopes stay in their parents, `computed` is never collected.
- [ ] **`style` from api data** is still set as given (no script, but `url()` can call out).

## 2. Framework fixes for what the services keep getting wrong

The same mistakes showed up in mesh-serve, surfdns-addons and surfdns-compute: the framework
should make the right way the easy one.

- [ ] **CRUD write verbs internal by default.** Raw `create/update/delete` left public bypass the
      tool that wraps them (membership in mesh-serve; `addon`, `addonType` in addons; `machine`,
      `volume`, `deployment` in compute). Public only when declared.
- [ ] **One way to act as another tenant.** A bare `{ meta: { tenant_id } }` loses to the caller's
      `user.tenant_id` (compute called as the wrong tenant in five places): one helper sets both.
- [ ] **A listener added outside `register`** (a tool calling `broker.on`) outlives a reload:
      record it to the owner too, or refuse it.
- [ ] **A test kit with a real broker and database,** so services stop hand-making
      `IServiceContext` mocks: mocks hid an always-failing import in compute and a MySQL replication
      bug in addons.

## 3. Dependencies (mesh's package.json)

Five do the work: zod, mongodb, ws, eventemitter3, zod-to-json-schema.

- [ ] **express out:** used only by `core/UnifiedServer.ts` (never created: mesh-serve passes no
      `port`) and `transports/node/HTTPTransport.ts` (used by nothing).
- [ ] **`UnifiedServer` removed,** with `MeshNetwork`'s `server` and `sharedServer` paths.
- [ ] **`HTTPTransport` and `TCPTransport`:** removed from `@flybyme/mesh/node`, or kept and tested.
- [ ] **dotenv, typescript, @types/* to devDependencies** (dotenv: two test files; the rest build-time).
- [ ] **One test runner:** mesh is jest, every other repo vitest.

## 4. Time series CRUD out

`defineTimeSeries` is used by nothing outside mesh (the console's `TimeSeriesChart` is
mesh-web-charts, unrelated). Metrics belong to the telemetry sink.

- [ ] **mesh:** `interfaces/ITimeSeriesContract.ts`, `db/TimeSeriesRepository.ts`, `Database.tsRepo`,
      its paths in `DatabaseMiddleware`, `ServiceBroker`, `IServiceBroker`, `IToolContract`, the
      exports, the demo, `generated/api.ts`, `__tests__/TimeSeries.spec.ts`.
- [ ] **mesh-serve:** the `defineTimeSeries` parsers in `GenerateCommand.ts` and `discoverPartContracts.ts`.
- [ ] **docs:** `TIME_SERIES_CONTRACTS.md` removed; `DATABASE_INTEGRATION.md`, `MIGRATION.md` updated.

## 5. Mesh says tenant

- [ ] **"organization" is mesh-serve's word.** In mesh: the log field (`ServiceBroker.ts`
      `organizationOf`), `ISpan.organization`, `Tenancy.ts` (`inOrganization`, the `organizationId`
      meta field, "This call carries no organization"). Mesh says `tenant`; mesh-serve maps it.

## 6. Telemetry: one pluggable sink (logs, spans, metrics)

A node sends its own; nothing reads it back off stdout. Mesh ships the plain sinks; whoever runs
mesh plugs in where it goes (SurfDNS: streams.surfdns.net).

- [ ] **The sink interface:** structured log records, spans, metric snapshots; any number installed;
      one that throws never fails the work it describes.
- [ ] **Structured records** (the handler gets a formatted string today): time, level, message,
      fields, error with stack, trace and span id, and node, part and version on every one.
- [ ] **A handler's unexpected error logged** on the node that ran it, with its stack (today only
      event listeners' are, `ServiceBroker.ts:504`; an infer 500 left no line anywhere).
- [ ] **Failed spans always sent;** every span when asked (`MESH_SPANS=1`).
- [ ] **Metrics as data:** `MetricsRegistry.snapshot()`; `/metrics` becomes one sink among others.
- [ ] **Plain sinks shipped:** text to stdout (default), Prometheus, a batching HTTP sink (bounded
      buffer, a POST a second, drops counted, never slowing the node; `fetch`, Node and browser).
- [ ] **Flood control** (repeat suppression, a rate cap; mesh-web's `createRepeatFilter` moves down),
      **redaction** (field names and values stripped), **a node's level changed while it runs**.
- [ ] **`console.*` onto the logger:** 13 in mesh, 45 in mesh-serve (53 in the surfdns services).

## 7. mesh-serve

- [ ] **Installs sinks from its configuration;** nothing of SurfDNS.
- [ ] **One record per api request** (method, path, status, duration, tenant) and **per part load,
      unload and deploy** (part, build, duration, heap before and after).
- [ ] **Revert a4235e4** (JSON to stdout, unreleased): replaced by the sink.
- [ ] **Old modules freed on unload:** undici's global dispatcher holds a part's first build,
      `globalThis['mesh.globalCrudRegistry']` its latest; CrudRegistry drops an owner's cruds.
- [ ] **Four listeners per node** (mesh, api, sites, metrics): one server with routes, later.

## 8. mesh-web

- [ ] **The same sink in the kernel:** log records, spans for its calls, metrics; default sink the
      in-page buffer it has now.
- [ ] **A call's trace id goes to the server,** so one trace runs page -> gateway -> node.
- [ ] **Analytics as metrics:** page views (the route, not its parameters), a visitor per day, no cookie.

## 9. Packaging and docs before going public

- [ ] **Our names out of code that ships:** SurfDNS and Peera in describe strings and contracts,
      `one-host.ca`, `registry.surfdns.net` in `package.json`s, generated clients.
- [ ] **`README.md` listed in `files` but missing** (mesh-serve; the same in addons and compute).
- [ ] **Stale docs** brought to the code (each repo's docs/; comments citing our dates and hosts).
- [ ] **Casts:** mesh ~347 lines (incl. `any` in `ILogger`, `IMeshApp`), mesh-serve 57 `as` + 36 `!`,
      mesh-web 49 `as` + 13 `!`.
