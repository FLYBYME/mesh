# Stability

**mesh is frozen. Bug fixes only. Nothing breaking.**

Decided 2026-09-09. This is not a phase — it is the settled position, and it applies until somebody
explicitly reverses it in this file.

## The rule

| change | allowed |
| --- | --- |
| fixing a defect in existing behaviour | yes |
| adding something purely additive that nothing else can observe | case by case, and the burden is on the change |
| changing a signature, a return shape, an option's meaning, a default | **no** |
| adding a base class, a lifecycle hook or a registry field for a downstream package | **no** |
| removing anything | **no** |

A version bump is not a licence. 2.x has consumers that are not going to be migrated on a whim.

## Why

**mesh comes first. Everything else is second.** mesh-serve, mesh-web and mesh-core are all built on
it, and they are built on it *concurrently* — a breaking change in mesh does not cost one migration,
it costs three, plus every application on top of them. The dependency graph has one root and no
redundancy, so the root is the one place where "it's a small change" is never true.

The window for breaking things was the move to v2. That was the trade: take the pain once, in the
open, with a migration guide ([MIGRATION_2.0.md](./MIGRATION_2.0.md)). **That window is closed.**
Reopening it costs more than the second break is worth, and a framework that breaks twice teaches
its consumers to vendor it.

## What this means downstream

Read this as a design constraint, not an inconvenience. When a downstream package wants something
from mesh, the answer is almost always to build it downstream:

- `ApiService` and `McpService` are `ServiceModule` subclasses defined **in mesh-serve**, not in
  mesh. A new kind of module belongs in whichever package needs it.
- mesh does not provide an API surface — no HTTP, no MCP, no REST. That is not a gap. `ApiService`
  in mesh-serve is where the api lives, and it is right that it lives there: the framework routes
  calls between peers, and how those calls reach the outside world is a deployment's business.
- If a design needs a new hook in the broker or a new field on the contract registry, that is a
  signal the design is in the wrong package — not a request for mesh.

The test to apply to any proposal: **could this be built in mesh-serve or mesh-web instead?** If
yes, build it there. If genuinely no, say why in the proposal, out loud, before writing code.

## Precedent

The `kind: 'agent'` design (mesh-serve `spec/mcp.md`) was cut down by this rule and is better for it.
The first shape made an agent part a module that *ran*, with per-role tool registration — which would
have needed role metadata on `globalContractRegistry` and a new base class, both in mesh. The second
shape makes an agent part a **description** that `McpService` interprets: contracts, roles, and the
text to show a model. Task-shaped tools are then ordinary contracts with ordinary handlers, which
already have a home in a service module.

The constraint did not prevent the feature. It found the simpler version of it.
