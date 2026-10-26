# Mesh: what's left before it stands on its own

Mesh is the framework (mesh, mesh-serve, mesh-web, mesh-web-kit), public one day and naming nothing
of SurfDNS. This is its own list, from the owner's questions of 2026-10-26. SurfDNS's work that
builds on it (streams.surfdns.net, the dashboards) is in company/architecture/design/streams-site.md.

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
