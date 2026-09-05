### Summary of Work

Added a runtime registry for event definitions, mirroring [`ContractRegistry`](file:///home/ubuntu/code/mesh-dispatch-6/src/interfaces/IToolContract.ts#L21### Work Completed

Added a runtime registry for event definitions, mirroring [`ContractRegistry`](file:///home/ubuntu/code/mesh-dispatch-6/src/interfaces/IToolContract.ts#L219) and [`globalContractRegistry`](file:///home/ubuntu/code/mesh-dispatch-6/src/interfaces/IToolContract.ts#L308) in [`src/interfaces/IToolContract.ts`](file:///home/ubuntu/code/mesh-dispatch-6/src/interfaces/IToolContract.ts).

[`defineEvent`](file:///home/ubuntu/code/mesh-dispatch-6/src/interfaces/IEventContract.ts#L93-L113) now auto-registers every defined event in [`globalEventRegistry`](file:///home/ubuntu/code/mesh-dispatch-6/src/interfaces/IEventContract.ts#L173), allowing runtime consumers (such as `mesh-serve`'s API) to resolve an event name back to its payload schema and scoping rule ([`scopedBy`](file:///home/ubuntu/code/mesh-dispatch-6/src/interfaces/IEventContract.ts#L12)).

```typescript
// Contract side
globalContractRegistry.get('identity.whoami')

// Event side (now available)
globalEventRegistry.get('cdn.site_deployed')
```

---

### Key Decisions

1. **Duplicate names (first-wins dedup matching `ContractRegistry`)**:
   - Calling [`EventContractRegistry.register()`](file:///home/ubuntu/code/mesh-dispatch-6/src/interfaces/IEventContract.ts#L125-L130) with an already-registered event name preserves the original registration and ignores subsequent registrations (`if (this.events.has(event.name)) return;`).
   - Keeps registration idempotent across repeated imports and tests while preventing unexpected clobbering of event schemas or scoping rules.

2. **Test isolation (`clear()`)**:
   - Implemented [`clear()`](file:///home/ubuntu/code/mesh-dispatch-6/src/interfaces/IEventContract.ts#L136-L138) on [`EventContractRegistry`](file:///home/ubuntu/code/mesh-dispatch-6/src/interfaces/IEventContract.ts#L122-L163) and [`globalEventRegistry`](file:///home/ubuntu/code/mesh-dispatch-6/src/interfaces/IEventContract.ts#L173).
   - Allows tests to reset registry state in `beforeEach` / `afterEach` hooks to guarantee test order independence.

3. **Built-in events are NOT registered**:
   - Built-in events (`mesh.started`, `mesh.stopped`, `data.created`, `data.updated`, `data.deleted`) are deliberately not registered in [`globalEventRegistry`](file:///home/ubuntu/code/mesh-dispatch-6/src/interfaces/IEventContract.ts#L173).
   - Generic persistence events (`data.*`) cannot be statically scoped and must never be exposed to browser streams. `mesh.started` and `mesh.stopped` are internal node lifecycle events. Registering them would falsely imply they are exposable to browser client streaming subscriptions.

4. **Preserved return shape**:
   - [`defineEvent`](file:///home/ubuntu/code/mesh-dispatch-6/src/interfaces/IEventContract.ts#L93-L113) continues to return the exact [`EventDefinition<T>`](file:///home/ubuntu/code/mesh-dispatch-6/src/interfaces/IEventContract.ts#L9-L13) object (`{ name, schema }` or `{ name, schema, scopedBy }`) so destructuring callers are unaffected.

5. **Naming & type safety**:
   - Named the runtime class [`EventContractRegistry`](file:///home/ubuntu/code/mesh-dispatch-6/src/interfaces/IEventContract.ts#L122-L163) and the singleton [`globalEventRegistry`](file:///home/ubuntu/code/mesh-dispatch-6/src/interfaces/IEventContract.ts#L173).
   - Preserves [`EventRegistry`](file:///home/ubuntu/code/mesh-dispatch-6/src/interfaces/IEventContract.ts#L178-L188) as the compile-time type-level augmentation interface (`<K extends keyof EventRegistry>`), avoiding shadowing and type collision.

6. **Documentation corrected**:
   - Updated JSDoc comments in [`src/interfaces/IToolContract.ts`](file:///home/ubuntu/code/mesh-dispatch-6/src/interfaces/IToolContract.ts#L214-L220) and [`src/interfaces/IEventContract.ts`](file:///home/ubuntu/code/mesh-dispatch-6/src/interfaces/IEventContract.ts#L88-L121) to reflect runtime API consumption alongside server routes and code generation.

---

### Files Modified

- [`src/interfaces/IEventContract.ts`](file:///home/ubuntu/code/mesh-dispatch-6/src/interfaces/IEventContract.ts): Added [`EventContractRegistry`](file:///home/ubuntu/code/mesh-dispatch-6/src/interfaces/IEventContract.ts#L122-L163) and [`globalEventRegistry`](file:///home/ubuntu/code/mesh-dispatch-6/src/interfaces/IEventContract.ts#L173); updated [`defineEvent`](file:///home/ubuntu/code/mesh-dispatch-6/src/interfaces/IEventContract.ts#L93-L113) to auto-register.
- [`src/interfaces/IToolContract.ts`](file:///home/ubuntu/code/mesh-dispatch-6/src/interfaces/IToolContract.ts): Corrected JSDoc on [`ContractRegistry`](file:///home/ubuntu/code/mesh-dispatch-6/src/interfaces/IToolContract.ts#L214-L220).
- [`src/__tests__/interfaces/IEventContract.spec.ts`](file:///home/ubuntu/code/mesh-dispatch-6/src/__tests__/interfaces/IEventContract.spec.ts): Added 12 new unit tests covering auto-registration, duplicate first-wins dedup, `clear()`, exclusion of built-in events, return value preservation, and collection helpers (`entries`, `values`, `size`, `byDomain`).

---

### Verification

Verified with `agent-runs/finish.sh 6`:
- **Forbidden Casts Check**: `none` (zero occurrences of `as any`, `as never`, or `as unknown as`).
- **TypeScript Check**: `npx tsc --noEmit` passed cleanly.
- **Tests**: 36 test suites passed, 379 tests passed (367 baseline + 12 new tests).
- **Git Commit**: Committed on branch `dispatch/6` with commit [`89a4e0c`](file:///home/ubuntu/code/mesh-dispatch-6) (`Add runtime event registry mirroring ContractRegistry`) without attribution trailers.
3) to auto-register definitions into `globalEventRegistry`.

2. **[`src/interfaces/IToolContract.ts`](file:///home/ubuntu/code/mesh-dispatch-6/src/interfaces/IToolContract.ts)**:
   - Updated [`ContractRegistry`](file:///home/ubuntu/code/mesh-dispatch-6/src/interfaces/IToolContract.ts#L214-L220) JSDoc comment to document API consumption alongside server and generator consumers.

3. **[`src/__tests__/interfaces/IEventContract.spec.ts`](file:///home/ubuntu/code/mesh-dispatch-6/src/__tests__/interfaces/IEventContract.spec.ts)**:
   - Added unit test suites verifying:
     - `defineEvent` auto-registration in `globalEventRegistry`.
     - First-wins duplicate handling matching `ContractRegistry`.
     - `clear()` resets registry state for test independence.
     - Built-in events are deliberately absent from the runtime registry.
     - Return value shape invariance for callers.
     - Inspection and collection methods (`entries`, `values`, `size`, `byDomain`).

---

### Verification

Ran `agent-runs/finish.sh 6` on `dispatch/6`:
- **Forbidden Casts Check:** `none` (zero occurrences of `as any`, `as never`, or `as unknown as`).
- **TypeScript Check:** `npx tsc --noEmit` passed cleanly with 0 errors.
- **Test Suite:** 36 test suites passed, 379 tests passed (367 baseline + 12 new tests in [`IEventContract.spec.ts`](file:///home/ubuntu/code/mesh-dispatch-6/src/__tests__/interfaces/IEventContract.spec.ts)).
- **Git Commit:** Committed cleanly on branch `dispatch/6` without attribution trailers:
  - Commit [`89a4e0c`](file:///home/ubuntu/code/mesh-dispatch-6): `Add runtime event registry mirroring ContractRegistry`
