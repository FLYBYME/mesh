# Migrating to mesh 2.0

Two breaking changes to contract definitions, plus a change to how mesh is released. Everything
written from 2026-08-31 onward is expected to comply.

---

## 1. `defineCrud` requires a `dependencies` array

`options` is no longer optional, and `dependencies` is a required field on it.

```ts
// 1.x
export const dnsRecordCrud = defineCrud('dnsRecord', DnsRecordSchema);

// 2.0
export const dnsRecordCrud = defineCrud('dnsRecord', DnsRecordSchema, {
    dependencies: ['dnsZone.get'],
});
```

Each entry is either a full contract key (`dnsZone.get`) or a bare domain (`dnsZone`), the latter
meaning "depends on that domain generally". Domains may not contain underscores; actions may, so
`node.find_one` is valid and `bad_domain.find` is not. Duplicates are rejected.

**`dependencies: []` is the answer for a collection that calls nothing.** It is not a placeholder
— an empty array is a claim that the collection is a leaf, and the point of making the field
required is that nobody gets to skip the question.

`defineContract` also accepts `dependencies`, but there it stays optional.

### Why

A registry of ~1,500 contracts with no declared edges between them can only be understood by
reading every handler. That cost is paid again by every person and every agent that touches the
codebase, and it grows with the code. Declaring the edges at definition time makes the dependency
graph a fact you can query instead of a thing you reconstruct.

### Checking the declarations

`defineCrud` validates *shape* at definition time but cannot validate *targets* — contracts
register at import time, in whatever order the module graph produces, so a target may legitimately
not exist yet. Once the graph is loaded:

```ts
const unresolved = globalContractRegistry.findUnresolvedDependencies();
// [{ contract: 'site.create', dependency: 'dsn.zone_get' }, ...]
```

---

## 2. `visibility`, defaulting to `internal`

Every contract now has an optional `visibility` of `'public' | 'internal'`. **Absent means
`internal`.** That default is the breaking part: a contract is private until its author publishes
it, rather than the reverse.

```ts
export const dnsRecordCrud = defineCrud('dnsRecord', DnsRecordSchema, {
    dependencies: ['dnsZone.get'],
    // Only these two are callable from outside. create/update/delete stay internal.
    visibility: { find: 'public', get: 'public' },
});

export const dnsRecordCreateContract = defineContract({
    domain: 'dns',
    action: 'record_create',
    visibility: 'public',
    // ...
});
```

Query it through the registry:

```ts
globalContractRegistry.publicContracts();     // the published surface
globalContractRegistry.internalContracts();   // implementation detail
globalContractRegistry.byDomain('dnsRecord'); // everything one domain owns
```

or in code, via `visibilityOf(contract)` and `isPublicContract(contract)`.

### Why

`defineCrud` mints ten globally addressable contracts per collection. In the paas repo that is
1,010 generated contracts against 504 hand-written ones — and measured against the actual call
graph, **855 of the 1,010 are never called from outside the package that owns them**. They exist
only to be registered, indexed, listed, and read by something trying to work out what is callable.
Marking them internal removes them from that surface without removing them from the code.

### What 2.0 does *not* do

**The broker does not yet refuse an internal call.** Visibility is metadata and introspection in
this release only. Turning on enforcement would break every existing cross-domain CRUD call at
once, which is not a thing to do in the same version that introduces the field.

Annotate first, measure what breaks, then enforce.

---

## 3. Releases are cut from tags

`publish.yml` used to fire on every push to master as well as on tags. It now fires **only** on
`v*` tags, and the job fails if the tag does not match the version in `package.json`.

To release:

```bash
# bump "version" in package.json, commit, merge to master, then:
git tag v2.0.0
git push origin v2.0.0
```

`ci.yml` is new and runs build + tests on pushes to master and on pull requests. That is the check
to require in the branch protection rule.
