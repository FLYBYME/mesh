# What exists, what should run, what is running

Decided 2026-09-05. The companion to
[SUPERVISOR_AS_DESIRED_STATE.md](./SUPERVISOR_AS_DESIRED_STATE.md), which moved *desired* into a
collection and left the other two unnamed.

> "i just care about what runs on diffrent nodes and if a service is unavalable. i will forever be
> adding more services and contract."
>
> "fuck i just dont know what to do, becouse this needs to be held somewhere."

---

## 1. The thing that makes this hard

A deployment is part code and part data, the two are currently written in one file, and there is no
rule saying which is which. So every field feels like it could go either way, and the answer to "where
does this live" is unavailable — not because it is subtle, but because the question has been asked
about a mixture.

The mixture is real and it is not a mistake. An exposure list **cannot** be JSON: an entry references
an actual contract object.

```ts
// surfdns-console/service/src/expose.ts
{ contract: contractOf(ticketIssueContract), auth: 'public', errors: ['invalid_credentials'] },
```

`ticketIssueContract` is imported from a package. No JSON file can hold it. That is settled and this
document does not reopen it.

But the same file's neighbour shows the cost of leaving the line undrawn:

```ts
// surfdns-console/service/src/site.ts:96
modules: [
    { domain: 'identity', tools: ['identity.ticket_issue', /* …seven */] },
    { domain: 'console',  tools: ['console.status'] },
    { domain: 'api',      tools: ['api.status', 'api.routes'] },
],
```

A hand-maintained list of what this process is running, with a comment explaining that adding a module
without adding it here is "a visible omission in one screen of code." That is `role-services.json`
again — the same defect, one repository over, in code written last week by someone who had already
identified the pattern elsewhere. It recurs because nothing says it shouldn't.

Twenty lines below, `seedRoles` calls `store.upsertRole` and `store.addGrant` with literal arguments,
re-executed on every boot. **Those are CRUD writes hardcoded into a function.** The data is already
data; it is wearing a TypeScript costume.

## 2. The rule

> **Something is code if and only if it references a live object — a contract, a function, a class.
> Everything else is a row.**

Applied to `site.ts` and `mesh.json`, nothing is ambiguous:

| | | why |
| --- | --- | --- |
| `expose` | **code** | names contract objects |
| `authorize`, `onError` | **code** | functions |
| `createIdentityModule({ store, … })` | **code** | constructs a module |
| port, host, nodeId, namespace | row | scalars |
| `application`, `allowOrigins`, `validateTool` | row | scalars; `validateTool` is already a string |
| the `modules` list above | row | and a *derived* one — see §4 |
| roles and grants in `seedRoles` | row | already CRUD writes, spelled as code |
| everything in `mesh.json` | row | it is already JSON; it is simply in the wrong place |

## 3. Three collections, three writers

The reason "where does this live" had no answer is that it is three questions with three different
owners, and only one of them is written by a person.

| | written by | holds |
| --- | --- | --- |
| **declared** | the build | what contracts and services exist in this artifact |
| **desired** | a person, through the org-scoped API | what should run on which node |
| **observed** | the nodes | what is actually mounted, and what is advertising |

The repository stays the source of truth for **what exists**. The collections are the source of truth
for **what runs**. Those two were tangled together in `mesh.json` and `site.ts`, which is why neither
had an obvious home.

## 4. Declared is generated, never written

This is what makes "I will forever be adding more services and contracts" survivable rather than a
growing maintenance burden.

`describeExposure()` already turns an exposure list into serializable rows — `{ method, path, key,
gate }` — **with no cluster running**. It exists, it is tested, and the console's client is generated
from it today. So:

- Contracts stay code, because they must.
- Their **description** is a build output.
- The build emits declared rows; nobody types them.

The hand-written `modules` list in §1 disappears entirely, because it is exactly this, computed by
hand. A service added to a repository appears in declared because it was built, not because someone
remembered.

## 5. The two questions, as diffs

| question | answer |
| --- | --- |
| what runs on different nodes | desired, joined to observed |
| **is a service unavailable** | **desired − observed** |
| exists but was never deployed anywhere | declared − desired |
| running something no current build contains | observed − declared |

The third and fourth are free once the first two exist, and the fourth is the one that catches a stale
node — the failure mode that produced *"stale mongo, stale k3d, nobody knows anything."*

## 6. Availability is a write, not a mechanism

The registry already computes availability. `ServiceBroker` produces this when a call has nowhere to
go:

> the contract is defined (schema registered), but none of the N connected node(s) advertises it — the
> owning service is not running in any role you are connected to

To produce that sentence it must already know which nodes advertise which domains. What is missing is
that **nothing records it**, so the knowledge exists only inside a failed call's error message. The
work here is writing observed down, not discovering it.

Two writers, deliberately kept separate:

- The **Supervisor** writes what it mounted, including mount failures, which it already computes.
- The **registry** knows what is advertised across the mesh.

Mounted-but-not-advertising is a real and interesting state. Collapsing the two writers into one field
would hide it.

## 7. What becomes of `mesh.json` and `site.ts`

`mesh.json` stays where it is. It is **build input** — a build reads it from a commit with no cluster
running, which is the property that makes an artifact reproducible from a ref. What it produces
(declared rows, an artifact digest) is what lands in the collections. Build input and runtime state are
two files on purpose; merging them for tidiness would cost the reproducibility.

`site.ts` splits three ways:

- The module construction and the two functions stay as code, and become the fixed runtime of
  [SUPERVISOR_AS_DESIRED_STATE §7](./SUPERVISOR_AS_DESIRED_STATE.md).
- The scalars become rows.
- `seedRoles` and `seedOperator` stop being boot-time code. They are CRUD writes and belong on the
  org-scoped API, performed once by a deploy, not re-executed on every start. `seedOperator` already
  documents why a boot-time version would be wrong — *"a deployment that created an operator on every
  boot would be creating a known credential in production"* — and the same argument applies one step
  further than it was taken.

## 8. Open

- ~~**When declared is written.**~~ **Decided 2026-09-05: at build.** The artifact carries its own
  description, so registering it needs no rebuild and a deploy is a write rather than a compile. This
  makes declared a catalogue of everything ever built rather than only what is deployable — the larger
  of the two sets, and the right one, because *"exists but was never deployed anywhere"* (§5) is a
  question worth being able to ask.
  It also has to carry **which framework or runtime version the artifact was built against.** With
  parts built separately there is no single build to catch a mismatch, so this field is the only thing
  standing between a version skew and a failure that appears in someone else's browser. See
  [mesh-web A9.1a](https://github.com/FLYBYME/mesh-web/blob/master/spec/roadmap.md).
- **How declared is keyed across versions.** Two artifacts can declare the same contract with different
  schemas. If declared is keyed by contract alone, an upgrade silently overwrites; keyed by
  `(artifact, contract)`, the diffs in §5 need a notion of which artifact a node is running.
- **Whether roles and grants belong in this model at all.** They are identity's own data, not process
  composition. §7 says they move to the API, which is right, but they are not declared/desired/observed
  and should not be forced into it.
- **Mounted but not advertising.** Named in §6 as worth keeping visible. Whether it is an error, a
  transient state during startup, or both, decides whether it belongs in the unavailability diff.
