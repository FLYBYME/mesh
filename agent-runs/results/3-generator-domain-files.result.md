I have initiated `npm run build && npx tsc --noEmit` and am awaiting execution results.
I have launched `agent-runs/finish.sh 3` to verify the worktree and am awaiting verification results.
I am waiting for `finish.sh 3` to complete verification.
I am awaiting the verification results of `finish.sh 3`.
### Root Cause Diagnosis

In [`src/cli/commands/GenerateCommand.ts`](file:///home/ubuntu/code/mesh-dispatch-3/src/cli/commands/GenerateCommand.ts), contract discovery collected all contracts into a flat list while indexing files by domain:

```typescript
const domainFiles = files[m.domain];
const alias = aliasMap[domainFiles[0]!]?.alias;
```

This pattern in [`generateToolRegistry`](file:///home/ubuntu/code/mesh-dispatch-3/src/cli/commands/GenerateCommand.ts#L148), [`generateCLI`](file:///home/ubuntu/code/mesh-dispatch-3/src/cli/commands/GenerateCommand.ts#L282), and [`generateEvents`](file:///home/ubuntu/code/mesh-dispatch-3/src/cli/commands/GenerateCommand.ts#L207) looked up module aliases using `domainFiles[0]!`. As a consequence, every contract, CLI subcommand, and named CRUD event in a domain was emitted against whichever file of that domain was scanned first. Contracts defined in any subsequent file of the same domain produced references to symbols not exported by that first file, resulting in TypeScript compilation errors (such as `TS2339 / TS2551: Property ... does not exist on type 'typeof import(...)'`).

---

### Solution

1. **Retain defining file path on [`ContractDiscovery`](file:///home/ubuntu/code/mesh-dispatch-3/src/cli/commands/GenerateCommand.ts#L7-L16)**:
   - Added `filePath: string` to the [`ContractDiscovery`](file:///home/ubuntu/code/mesh-dispatch-3/src/cli/commands/GenerateCommand.ts#L7-L16) interface.
   - Populated `filePath: file` when parsing `defineContract`, `defineCrud`, and `defineTimeSeries` inside [`discoverContractsAndEvents`](file:///home/ubuntu/code/mesh-dispatch-3/src/cli/commands/GenerateCommand.ts#L410).

2. **Resolve aliases by contract file path**:
   - In [`generateToolRegistry`](file:///home/ubuntu/code/mesh-dispatch-3/src/cli/commands/GenerateCommand.ts#L148): replaced `domainFiles[0]!` lookup with `aliasMap[m.filePath]?.alias`.
   - In [`generateCLI`](file:///home/ubuntu/code/mesh-dispatch-3/src/cli/commands/GenerateCommand.ts#L282): replaced `domainFiles[0]!` lookup with `aliasMap[m.filePath]?.alias`.
   - In [`generateEvents`](file:///home/ubuntu/code/mesh-dispatch-3/src/cli/commands/GenerateCommand.ts#L207): replaced `domainFiles[0]!` lookup for named CRUD events with `aliasMap[m.filePath]?.alias`.

3. **Exclude test fixtures in [`walkDir`](file:///home/ubuntu/code/mesh-dispatch-3/src/cli/commands/GenerateCommand.ts#L547-L561)**:
   - Updated directory traversal to skip `__tests__`, `dist`, `node_modules`, and `.git` subdirectories so test fixtures are not inadvertently picked up during production code generation.

4. **Add `--out <dir>` support**:
   - Updated `execute({ dir, out })` and Commander options to allow specifying the output directory.

---

### Test Coverage

1. **Split-domain fixture** ([`src/__tests__/fixtures/split-domain/`](file:///home/ubuntu/code/mesh-dispatch-3/src/__tests__/fixtures/split-domain)):
   - [`site.contract.ts`](file:///home/ubuntu/code/mesh-dispatch-3/src/__tests__/fixtures/split-domain/site.contract.ts): defines `siteComposeContract` (action `compose`) and `siteEvent` under domain `cdn`.
   - [`release.contract.ts`](file:///home/ubuntu/code/mesh-dispatch-3/src/__tests__/fixtures/split-domain/release.contract.ts): defines `releaseDeployContract` (action `deploy`), `releaseCrud`, and `releaseEvent` under domain `cdn`.

2. **Integration tests** in [`src/__tests__/GenerateCommand.spec.ts`](file:///home/ubuntu/code/mesh-dispatch-3/src/__tests__/GenerateCommand.spec.ts#L90-L233):
   - Asserts [`api.ts`](file:///home/ubuntu/code/mesh-dispatch-3/src/generated/api.ts) imports and references `siteComposeContract` through the `site.contract` module alias, and `releaseDeployContract` + `releaseCrud` through the `release.contract` module alias.
   - Asserts [`ToolCommands.ts`](file:///home/ubuntu/code/mesh-dispatch-3/src/generated/cli/ToolCommands.ts) wires commander subcommands (`cdn compose` vs `cdn deploy` / `cdn create`) to their respective declaring module aliases.
   - Asserts [`events.ts`](file:///home/ubuntu/code/mesh-dispatch-3/src/generated/events.ts) maps event types and CRUD lifecycle events (`cdn.created`, `cdn.updated`) to their defining modules.
   - Asserts the general invariant that every emitted `alias.symbol` reference in generated artifacts names a symbol exported by the module that `alias` imports from.

---

### Verification

- `npx tsc --noEmit`: Clean (0 errors).
- `agent-runs/finish.sh 3`:
  - Forbidden casts check: `none` (`as any`, `as never`, `as unknown as`).
  - Test suites: **35 passed, 35 total** (344 passed tests: 338 baseline + 6 new/updated tests).
- Committed on branch `dispatch/3` in worktree `FLYBYME/mesh` (commit [`acb0635`](file:///home/ubuntu/code/mesh-dispatch-3)).
