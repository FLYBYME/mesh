### Investigation & Architectural Context

Before introducing unique key declarations and MongoDB indexing to `defineCrud`, the persistence layer was investigated across:
1. **Contract Definition** (`src/interfaces/ICrudContract.ts`):
   - `defineCrud` accepted options (`idField`, `scopedBy`, `relations`, `visibility`, `dependencies`), but provided no way to declare field uniqueness.
   - Ten standard CRUD tool contracts (`find`, `findOne`, `count`, `get`, `resolve`, `create`, `createMany`, `update`, `replace`, `delete`) were generated and registered into `globalContractRegistry`, but there was no runtime `globalCrudRegistry` tracking collection definitions.
2. **Database & Repository Layer** (`src/db/Database.ts`, `src/db/DomainRepository.ts`):
   - `Database.repo()` synchronously returned a cached `DomainRepository`.
   - `DomainRepository` executed `insertOne`, `findOneAndUpdate`, and `findOneAndReplace` without unique index awareness. Duplicate key collisions resulted in unhandled MongoDB driver errors.
   - There was no index creation anywhere in the repository.
3. **Application Lifecycle** (`src/modules/DatabaseModule.ts`):
   - `DatabaseModule.onStart()` connected to MongoDB and mounted middleware, providing the natural lifecycle point for upfront index creation before traffic is served.

---

### The Five Core Decisions

#### 1. When is the index created?
- **Decision:** Indexes are created in **two cooperating phases**:
  1. **Primary / Boot-time:** In `DatabaseModule.onStart()`, immediately after `await this.db.connect()`, `await this.db.ensureIndexes()` iterates all collections registered in `globalCrudRegistry` and creates their unique indexes upfront. This ensures that live requests on the hot path never pay the latency or round-trip cost of index creation.
  2. **Fallback / Lazy:** When `Database.repo(schema, domain)` is called (e.g. in isolated tests or dynamically loaded modules without `DatabaseModule`), it triggers `this.ensureDomainIndexes(domain)` and passes the `readyPromise` to `DomainRepository`.
  - **Zero Round-Trip Penalty on Subsequent Calls:** `Database.ensuredIndexes` (a `Map<string, Promise<void>>`) memoizes the index creation promise per collection per connection. Once started or completed, subsequent queries or `repo()` calls retrieve the cached promise instantly with zero extra round-trips to MongoDB. In `DomainRepository`, write operations (`create`, `update`, `replace`, `findOneAndUpdate`) await `this.readyPromise` to guarantee index readiness before writes.

#### 2. Legible duplicate errors (`MeshError`)
- **Decision:** MongoDB duplicate key errors (code `11000` / `DuplicateKey`) are caught in `DomainRepository` across all write operations (`create`, `update`, `replace`, `findOneAndUpdate`) and converted into a standardized `MeshError`:
  - `status: 409` (HTTP Conflict)
  - `code: 'CONFLICT'`
  - Single field message: `Duplicate value <value> for unique field "<field>" in collection "<collection>".`
  - Compound key message: `Duplicate value (<field1>=<val1>, <field2>=<val2>) for unique compound key (<field1>, <field2>) in collection "<collection>".`
  - Structured `data`: `{ collection, field/fields, value/values, keyValue }`
- **Reasoning:** Mongo's raw `E11000 duplicate key error collection: ... index: ... dup key: ...` is cryptic and exposes internal index names. Transforming it to `MeshError` teaches the caller exactly which domain, field, and value conflicted, meeting the explanatory standard of `defineCrud`.

#### 3. Existing data with duplicates (Refusing to start)
- **Decision:** **Refuse to start** (fail closed). If a collection contains duplicate data when attempting to build a unique index, `Database.ensureIndexes()` / `createIndex` throws a `MeshError`:
  - `status: 500`
  - `code: 'INDEX_CREATION_FAILED'`
  - `message: Failed to build unique index on collection "<collection>" for fields [<fields>]: existing data contains duplicates. Duplicates must be resolved before this unique index can be created.`
  - Structured `data`: `{ domain, fields, error }`
- **Reasoning:** Allowing a node to boot unindexed because of pre-existing duplicates creates a silent, dangerous failure mode: the application believes uniqueness is enforced, but the database allows duplicate writes. This directly compromises content addressing (`artifact.digest`), tenant hostname routing (`site.host`), and package version immutability (`partVersion`). Failing closed loudly halts deployment so operators can remediate duplicate records rather than compounding data corruption.

#### 4. Compound keys are ordered
- **Decision:** Compound key field order is **strictly preserved as specified by the caller** (e.g. `[['partName', 'version']]` creates index `{ partName: 1, version: 1 }`).
- **Reasoning:** In MongoDB and B-Tree indexes, column order determines index prefix query optimization. A query filtering by `partName` can utilize `{ partName: 1, version: 1 }`, but cannot utilize `{ version: 1, partName: 1 }`. Normalizing alphabetically would arbitrarily degrade query execution performance based on field naming. The order is intentional and callers retain full control over index prefix design. In addition, compound keys are validated to reject duplicates (e.g. `['partName', 'partName']`).

#### 5. Interaction with `scopedBy` (Distinguishing Scoped vs. Global)
- **Decision:** Disallow implicit defaults on scoped collections. Explicitly distinguish scoped vs. global unique keys:
  - On an **unscoped collection**: all unique keys are global by definition. Declaring `scope: 'scoped'` without `scopedBy` is rejected with an error.
  - On a **scoped collection**:
    - `scope: 'scoped'` (e.g. `{ fields: 'slug', scope: 'scoped' }`): Automatically prepends the `scopedBy` field to form a compound index in MongoDB: `{ tenantId: 1, slug: 1 }`. Multiple tenants can share the same slug, but duplicates within the same tenant are rejected.
    - `scope: 'global'` (e.g. `{ fields: 'host', scope: 'global' }`): Indexes the field globally across all tenants: `{ host: 1 }`. Cross-tenant hostname collision or takeover is rejected.
    - Explicit compound keys containing `scopedBy` (e.g. `[['tenantId', 'slug']]`) are recognized as scoped.
    - **Refusing Ambiguous Bare Keys:** If a caller declares a bare unique key (string or array) on a scoped collection without `scopedBy` and without specifying `scope`, `defineCrud` throws an error at definition time:
      `defineCrud Error: Collection "<domain>" is scoped by "<scopedBy>". Unique key "<field>" must explicitly declare scope: 'scoped' or scope: 'global' (e.g. { fields: "<field>", scope: 'scoped' }) so its tenant isolation boundary is explicit.`
- **Reasoning:** A default rule that assumes all keys are scoped breaks global resources like `site.host` (enabling tenant takeover). A default rule that assumes all keys are global breaks tenant slug isolation (preventing two tenants from having `main`). Requiring explicit qualification per unique key eliminates guesswork and prevents cross-tenant leaks.

---

### Files Modified

1. **`src/interfaces/ICrudContract.ts`**:
   - Added types: `UniqueScope`, `UniqueKeyDescriptor`, `UniqueOption`, `NormalizedUniqueKey`.
   - Added `normalizeUniqueKeys`: validates field existence against `baseSchema`, forbids ID fields, rejects compound duplicates, and resolves scoping boundaries.
   - Added `CrudRegistry` and `globalCrudRegistry`: in-memory registry of defined CRUD collections populated at `defineCrud` time.
   - Updated `AnyCrudContracts` and `CrudContracts` to include `readonly unique?: readonly NormalizedUniqueKey[]`.
   - Updated `defineCrud` options to accept `unique?: UniqueOption | readonly UniqueOption[]`, attaching normalized unique keys to the result and registering into `globalCrudRegistry`.

2. **`src/db/Database.ts`**:
   - Added `ensuredIndexes` memoization map (`Map<string, Promise<void>>`).
   - Added `ensureIndexes(domain?)` and `ensureDomainIndexes(domain, uniqueKeys)`: ensures unique indexes on MongoDB collections with `{ unique: true }`. Catches duplicate build errors and converts them to `MeshError('INDEX_CREATION_FAILED')`.
   - Updated `repo()` to retrieve unique keys from options or `globalCrudRegistry`, initiating/retrieving the cached `readyPromise` and passing it to `DomainRepository`.
   - Updated `disconnect()` to clear index and repository caches.

3. **`src/db/DomainRepository.ts`**:
   - Updated constructor to accept optional `readyPromise?: Promise<void>` and `uniqueKeys?: readonly NormalizedUniqueKey[]`.
   - Added `handleDuplicateKeyError(err)`: converts MongoDB code 11000 errors into legible `MeshError` with `status: 409`, `code: 'CONFLICT'`, naming collection, field(s), and value(s).
   - Wrapped `create`, `update`, `replace`, and `findOneAndUpdate` to await `this.readyPromise` and catch duplicate key errors via `handleDuplicateKeyError`.

4. **`src/modules/DatabaseModule.ts`**:
   - Updated `onStart()` to call `await this.db.ensureIndexes()` immediately after `connect()`. Halts boot if existing data contains duplicates.

5. **`src/__tests__/interfaces/ICrudContract.spec.ts`**:
   - Added unit test suite for `unique` options in `defineCrud`: single keys, compound keys, order preservation, scoped prepending, global preservation, ambiguous key refusal, ID field refusal, non-existent field refusal, duplicate compound field refusal, and empty key array refusal.

6. **`src/__tests__/db/UniqueKeys.spec.ts`**:
   - Added end-to-end and integration test suite covering:
     - Index creation timing (`DatabaseModule.onStart` and lazy `repo()`).
     - Idempotency / memoization (zero additional `createIndex` calls).
     - Legible duplicate `MeshError` (409 CONFLICT) across `create`, `update`, `replace`, `findOneAndUpdate`, and `create_many`.
     - Refusal to start on dirty data with duplicates (500 INDEX_CREATION_FAILED).
     - Compound index field ordering (`partName, version` vs `version, partName`).
     - Multi-tenant `scopedBy` interaction (`slug` scoped per tenant, `host` global across tenants).
     - Broker-routed CRUD operations enforcing uniqueness.

---

### Verification

Executed `agent-runs/finish.sh 5` on `dispatch/5`:
- **Forbidden Casts Check:** `none` (zero occurrences of `as any`, `as never`, or `as unknown as`).
- **Type Checking:** `npx tsc --noEmit` passed cleanly with 0 errors.
- **Test Suite:** 36 passed test suites, 0 failed (394 passed tests, 0 regressions from baseline).
- **Git Commit:** Committed on branch `dispatch/5` without AI attribution trailers:
  - Commit `f3b5155`: `Add unique key constraints to defineCrud and MongoDB repositories`
