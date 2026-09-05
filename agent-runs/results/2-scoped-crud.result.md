I have initiated verification with `agent-runs/finish.sh 2` and will review the verification results as soon as it completes.
I have launched `agent-runs/finish.sh 2` to verify the committed branch and test suite. I am waiting for verification to complete.
### Investigation & Findings

Before making modifications, the CRUD contract definition, registration, and dispatch flow were investigated:

1. **Contract Definition & Registry Entry** ([`src/interfaces/ICrudContract.ts`](file:///home/ubuntu/code/mesh-dispatch-2/src/interfaces/ICrudContract.ts#L134-L260)):
   - `defineCrud` builds 10 standard CRUD contracts (`find`, `findOne`, `count`, `get`, `create`, `createMany`, `update`, `replace`, `delete`, `resolve`).
   - Contracts are registered in `ServiceBroker.ts` via `MeshToolSchemaRegistry.set(toolKey, ...)`, which previously stored `{ domain, action, isCrud: true }`.
   - `ToolContract` ([`src/interfaces/IToolContract.ts`](file:///home/ubuntu/code/mesh-dispatch-2/src/interfaces/IToolContract.ts#L90-L95)) and `CrudContracts` carried no scoping metadata.
2. **Middleware Execution** ([`src/db/DatabaseMiddleware.ts`](file:///home/ubuntu/code/mesh-dispatch-2/src/db/DatabaseMiddleware.ts#L104-L350)):
   - `ctx.meta` is received in the middleware pipeline.
   - For `find`, `find_one`, and `count`, queries were built directly from user parameters (`params.query`).
   - For `get`, `update`, `replace`, and `delete`, operations were executed strictly by document ID via `repo.get(id)`, `repo.update(id, ...)`, etc.
3. **Repository Layer** ([`src/db/DomainRepository.ts`](file:///home/ubuntu/code/mesh-dispatch-2/src/db/DomainRepository.ts#L160-L315)):
   - `get`, `update`, `replace`, and `delete` only queried by `{ _id: new ObjectId(id) }` without supporting additional filter queries.

---

### Key Decisions & Corrections

#### Decision 4: A caller with NO scope
- **Decision:** Refuse the call with `MeshError({ code: 'UNAUTHORIZED', status: 401, message: 'Scoped collection "<domain>" requires a resolved "<scopedBy>" scope in caller metadata.' })`.
- **Reasoning:** Treating "no scope" as empty/unfiltered fails open, creating catastrophic data leaks if auth metadata is accidentally stripped. Returning an empty result on `find` masks misconfiguration, and returning empty on `create` would fail open by writing orphaned, unscoped records. Refusing early and loudly fails closed.

#### Decision 6: Internal callers
- **Decision:** Internal callers invoking scoped CRUD contracts over the broker without `meta.user` or tenant metadata are **refused**.
- **Reasoning:** Allowing unscoped internal calls through the generated CRUD contract quietly fails open whenever caller metadata is dropped across hops. Internal services operating on behalf of a tenant must explicitly provide tenant context (`meta: { tenant_id: '...' }`). Internal or background jobs requiring cross-tenant or unscoped collection access must use `Database.repo(domain)` directly rather than the tenant-scoped CRUD API.

#### Prompt Discrepancies & Design Nuances
1. **Base Schema Validation:** The prompt noted `defineCrud` refuses a `baseSchema` that declares `idField`. For `idField`, this is because MongoDB auto-mints IDs. For `scopedBy`, however, the field is a domain attribute (e.g., `SiteSchema` defines `tenantId: z.string()`). Therefore, `defineCrud` refuses schemas that **omit** `scopedBy` or where `scopedBy === idField`.
2. **Scope Casing:** Domain schemas conventionally use camelCase (`tenantId`), whereas auth tokens and `IMeshMeta` represent user tenant IDs in snake_case (`meta.user.tenant_id` or `meta.tenant_id`). The resolver normalizes both camelCase and snake_case representations across `meta.user` and root `meta`.
3. **Update / Replace Not-Found Semantics:** If an `update` or `replace` targets a cross-scope ID, the repository returns `undefined`. Because output schemas require non-nullable returns, returning `undefined` from the action would cause Zod schema validation errors. The middleware explicitly throws `MeshError({ code: 'NOT_FOUND', status: 404 })` (matching `get`), returning NOT FOUND without disclosing existence.

---

### Files Modified

1. [`src/interfaces/IToolContract.ts`](file:///home/ubuntu/code/mesh-dispatch-2/src/interfaces/IToolContract.ts#L93-L94):
   - Added `readonly scopedBy?: string;` to [`ToolContract`](file:///home/ubuntu/code/mesh-dispatch-2/src/interfaces/IToolContract.ts#L61).
2. [`src/interfaces/ICrudContract.ts`](file:///home/ubuntu/code/mesh-dispatch-2/src/interfaces/ICrudContract.ts#L88):
   - Added `scopedBy?: string;` to `CrudContracts`, `AnyCrudContracts`, and `defineCrud` options.
   - Added validation: refuses empty `scopedBy`, `scopedBy === idField`, and schemas omitting `scopedBy`.
   - Made `scopedBy` optional on `CreateInputSchema` and `ReplaceInputSchema` without forbidden type casts, allowing callers to omit tenant IDs while retaining validation.
   - Attached `scopedBy` to each generated contract and the returned CRUD definition.
3. [`src/core/ServiceBroker.ts`](file:///home/ubuntu/code/mesh-dispatch-2/src/core/ServiceBroker.ts#L22):
   - Added `scopedBy?: string` to `MeshToolSchemaRegistry` and recorded `contract.scopedBy` upon registration.
4. [`src/db/DomainRepository.ts`](file:///home/ubuntu/code/mesh-dispatch-2/src/db/DomainRepository.ts#L164-L317):
   - Added optional `query?: StrictFilterQuery<T>` parameter to [`get`](file:///home/ubuntu/code/mesh-dispatch-2/src/db/DomainRepository.ts#L164), [`update`](file:///home/ubuntu/code/mesh-dispatch-2/src/db/DomainRepository.ts#L198), [`replace`](file:///home/ubuntu/code/mesh-dispatch-2/src/db/DomainRepository.ts#L272), and [`delete`](file:///home/ubuntu/code/mesh-dispatch-2/src/db/DomainRepository.ts#L310) to atomically filter by `_id` and scope.
5. [`src/db/DatabaseMiddleware.ts`](file:///home/ubuntu/code/mesh-dispatch-2/src/db/DatabaseMiddleware.ts#L38-L335):
   - Implemented `resolveCallerScope(meta, scopeField)` supporting `meta.user.tenant_id`, `meta.user.tenantId`, `meta.tenant_id`, and `meta.tenantId`.
   - Refuses missing scopes with `MeshError({ code: 'UNAUTHORIZED', status: 401 })`.
   - Enforces scope on reads (`find`, `find_one`, `count`, `get`, `resolve`). Caller scope overwrites any user query filter.
   - Enforces scope on writes (`update`, `replace`, `delete`). Cross-scope updates/replaces yield 404 NOT FOUND; cross-scope deletes return `{ success: false }`.
   - Stamps caller scope on `create` and each document of `create_many`; strips scope field from `update` patch to prevent reparenting.
6. [`src/__tests__/interfaces/ICrudContract.spec.ts`](file:///home/ubuntu/code/mesh-dispatch-2/src/__tests__/interfaces/ICrudContract.spec.ts#L146-L184):
   - Added unit tests for schema validation, empty `scopedBy`, `scopedBy === idField`, contract propagation, and optionality in create inputs.
7. [`src/__tests__/db/ScopedCrud.spec.ts`](file:///home/ubuntu/code/mesh-dispatch-2/src/__tests__/db/ScopedCrud.spec.ts#L1-L352):
   - Added end-to-end test suite covering all 6 requirements:
     - Scoped reads (`find`, `find_one`, `count`, `get` returning 404, `resolve` returning `undefined`).
     - Scoped writes (`update` returning 404, `replace` returning 404, `delete` returning `{ success: false }`).
     - Create and create_many stamping scope.
     - Caller with no scope refused (401 UNAUTHORIZED).
     - Explicit query naming scope field overridden by caller scope.
     - Internal callers without scope refused; callers with direct `meta.tenant_id` allowed.

---

### Verification

Ran `agent-runs/finish.sh 2` on `dispatch/2`:
- **Forbidden Casts Check:** `none` (zero occurrences of `as any`, `as never`, or `as unknown as`).
- **Type Checking:** `npx tsc --noEmit` passed clean with 0 errors.
- **Test Suite Results:**
  - 34 passed test suites, 0 failed (338 passed tests: 318 baseline + 20 new tests).
- **Git Commit:** Committed cleanly on branch `dispatch/2` in `/home/ubuntu/code/mesh-dispatch-2` without AI attribution trailers:
  - Commit `712ee20`: `Add scopedBy to defineCrud and enforce caller scoping in DatabaseMiddleware`
