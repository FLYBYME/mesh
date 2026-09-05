# The Supervisor as a reconciler — desired state in CRUD, not a file

Decided 2026-09-05.

> "i think supervise needs a curds to help it manage this advanced distrobuted system"

This is the successor to [SUPERVISOR_AND_SERVICE_LIFECYCLE.md](./SUPERVISOR_AND_SERVICE_LIFECYCLE.md),
which built the Supervisor. Nothing in that document is retracted. The change here is small in code and
large in consequence: **what a node should run stops being a file read once at startup and becomes a
document the node converges toward.**

---

## 1. Why — counted, not asserted

There are at least seven ways to start a node across these repositories, and each one invents its own
answer to "what does this process consist of":

| | |
| --- | --- |
| `mesh start --services <dir>` | auto-discovers `*.service.js` and boots everything under a directory. **Retired by paas** — it starts port-binding edge listeners a control plane has no business running |
| `mesh supervise -c <manifest>` | loads exactly what the manifest lists; the current answer |
| `paas/bin/paas-run.mjs <role>` | a wrapper over `supervise`. Its own header says why it exists: mesh has no project-level CLI extension point |
| `build-roles` / `generate-full-manifest` / `generate-role-manifests` / `generate-role-services` | four generators keeping manifests in step with the code |
| `manifests/role-services.json` | hand-curated: which services belong to which role |
| `paas` `npm start` vs `npm run serve` | two boots in one `package.json`, and `start` is still the retired path |
| `mesh-web/scripts/deploy.mjs`, `surfdns-console/service/src/site.ts` | bespoke `MeshApp` constructions per product |

Seven files construct a `MeshApp` across the products, each with its own module list.

The generators, the curated JSON and the wrapper binary are not incidental. They exist because the
manifest is a build artifact, so **keeping it true to the code is a separate job that has to be
re-run** — and a hand-curated list of what runs where is the thing the platform kept outgrowing.

Meanwhile every other subsystem in the platform already works the other way. From paas's own mesh
conventions: *CRUD writes are declarations of intent, not commands. Reconcilers converge toward the
desired documents in any order.* Process composition was the one subsystem exempt from that, and the
generators are the price of the exemption.

## 2. What is already built — do not rebuild it

`src/supervisor/` is closer to a reconciler than it looks. Present and working:

- **Dynamic mount and unmount** through `registerModule` / `unregisterModule`. Services run inside the
  Supervisor's own process; nothing spawns a child.
- **`dependsOn` with a topological sort** and real cycle detection at load.
- **Honest partial failure.** An entry whose `path` fails to `import()`, or whose `onStart` throws, is
  marked `status: 'error'` with the real message, and everything depending on it — transitively — is
  marked `'error'` with `"Skipped: dependency not running: <names>"`. It does not start services
  against a broken dependency and does not report success.
- **A real control surface.** `SupervisorService` is a `ServiceModule` mounted before anything in the
  manifest, exposing `supervisor.service_start` / `service_stop` / `service_restart` / `service_status`
  as ordinary mesh contracts. `service_stop` refuses to stop something a running service depends on
  unless `cascade: true`.

**The gap is one line.** `loadManifest` is called exactly once, at CLI startup. Editing the manifest
while the Supervisor runs does nothing. The Supervisor is therefore a reconciler with no way to be
told the desired state changed, which is why the control surface had to be imperative.

## 3. The change

Desired state moves into a collection. A node reads the rows that name it and converges.

The existing imperative contracts (`service_start`, `service_stop`, `service_restart`) do not become
the mechanism — they become the **escape hatch** (§8). A command tells a node to do something now; a
document says what should be true. Only the second survives a restart, and only the second can be
queried to answer "what is this fleet running."

## 4. The collections

**The framework owns the shape it reads; the platform owns the data and the policy.** mesh defines
what an assignment must contain for the Supervisor to act on it. Which node exists, who may write one,
and what an organization is, are the platform's.

```
assignment
  _id
  nodeId        → node._id
  name          stable identifier, unique per node; what the control API targets
  path          what to import()
  dependsOn     [name]  — other assignments on this node
  desired       'running' | 'stopped'

  # Written only by the owning Supervisor. Never by user CRUD.
  observed      'running' | 'stopped' | 'error'
  observedAt
  error?        the real message when observed is 'error'
```

The desired/observed split follows the platform's existing exposure rule: consequential state fields —
anything a reconciler writes — are written only by the owning reconciler, and CRUD `.update` on them is
not exposed. `desired` is a user's to write; `observed` is the node's to report.

`node` already exists as the machine record and is not redefined here.

## 5. The reconcile loop

Unchanged in shape from every other reconciler in the platform:

1. On join, and on any change to an assignment naming this node, read the desired set.
2. Diff against what is mounted.
3. Unmount what should no longer run, respecting dependents exactly as `service_stop` already does.
4. Mount what should run, in `dependsOn` order, exactly as `startAll` already does.
5. Write `observed` back — including errors, which the Supervisor already computes correctly.

Step 5 is the one that must not be softened. A desired-state system whose observed side is optimistic
is worthless, and the existing partial-failure handling is already honest enough to build on.

## 6. What this deletes

`role-services.json`, `generate-role-manifests.mjs`, `generate-role-services.mjs`,
`generate-full-manifest.mjs`, `build-roles.mjs`, `bin/paas-run.mjs` and its role list, and per-role
container actions. One image, one command; what a process *is* comes from rows.

The bespoke `MeshApp` constructions in the product repos go the same way, replaced by the single
runtime of §7.

## 7. Runtime is fixed; assignment is data

Every node runs the same base before it can read anything: registry, network, broker, database client,
and `SupervisorService`. **That set is not assignable.** It is what makes a node a node.

Getting this line wrong produces an assignment that cannot be read because the thing that reads it was
never mounted. Everything above the base is a row; nothing below it is.

## 8. Genesis, and the escape hatch

`-c <file>` survives for exactly two cases and is not the normal path for either development or
production:

- **Genesis.** The first node cannot read its assignment from a database that does not exist yet. This
  is the platform's existing Tier -1 bootstrap and it stays file-driven.
- **A node that cannot reach the mesh.** See §9.

If the file path stays the ordinary route for local development it will drift from the CRUD path, and
the two will disagree at the worst moment. Local development should read assignments from a local
control plane, not from a file.

## 9. The gap this makes worse, named on purpose

The original document already recorded one: if the Supervisor's own broker or network cannot come up,
there is no way to reach it at all — the local-only control channel was scoped out.

**Moving desired state into the mesh makes that worse.** Today a node that cannot reach the mesh still
knows what to run, because the manifest is on disk. Afterwards it knows nothing. Two consequences, and
both belong in the first implementation rather than after the first outage:

- The Supervisor **caches the last assignment set it successfully read**, and starts from the cache
  when the control plane is unreachable — running the last known good composition, reporting that it is
  doing so, rather than running nothing.
- The local control channel stops being optional. It is the only way into a node that cannot reach the
  mesh, and a fleet of them is exactly the scenario it exists for.

## 10. Authorization falls out; it is not a new mechanism

An assignment is a document. Writing one is a contract call. Contract calls are already exposed,
gated and org-scoped by the platform's normal rules — so **"gated by the API" needs no bootstrap
protocol.** It is CRUD authorization applied to one more collection.

This also settles the ordering problem cleanly. A node joins the mesh mounting nothing, reads its own
desired state, and converges. **A node with no assignment sits there running nothing** — a legible,
queryable state, unlike a node half-admitted to a network.

Three planes, and they must not be confused:

| plane | who | credential |
| --- | --- | --- |
| **user** | a person or their API token, on the web/CLI/API | user credential, org-scoped |
| **bootstrap** | a node, once, at startup | node credential, put there by provisioning |
| **mesh** | node ↔ node thereafter | mesh membership; see below |

**A node must never hold a user credential.** The user plane is what authorizes an assignment to be
written; it is not what the node presents. A compromised edge node holding an org-scoped user token
would hold power over the whole organization.

## 11. Open

- **Node identity on the mesh plane.** Today node-to-node auth is `AuthInterceptorHMAC({ secret })` — a
  single shared secret for the whole mesh — and in `StartCommand` it is commented out
  (`StartCommand.ts:103`). A shared secret answers *are you a member* and nothing else: every node that
  joins is equally trusted, there is no per-node identity on the wire, and revoking one node means
  rotating the secret everywhere. Whether membership is enough, or the mesh plane needs per-node
  identity, changes what the bootstrap must hand a node — one config value, or a credential to issue,
  rotate and revoke.
- **Where cardinality lives.** An `edge` assignment and a `singleton` assignment react differently to
  join and leave. Whether cardinality is a property of the assignment, of the service, or of a process
  group above both is cheap to decide now and expensive to move later.
- **Watch or poll.** The reconcile trigger. An event on the collection is the obvious answer and
  inherits the platform's existing event conventions; a poll is the fallback that survives a missed
  event. Probably both, with the poll slow.
- **What happens to the imperative contracts.** Kept as the local escape hatch (§8), or removed so that
  there is exactly one way to change what a node runs. Keeping them means a node's actual composition
  can diverge from its documents, which is the drift this whole document exists to end.
