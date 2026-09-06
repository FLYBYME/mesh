I have started the test suite with `MONGODB_URI=mongodb://localhost:27017` and am waiting for the execution to complete.
I have initiated `MONGODB_URI=mongodb://localhost:27017 npm test` and am awaiting execution results.
I am running the test suite consecutively under both URI shapes to ensure reliability and absence of flake.
I am waiting for `npm run build` to complete.
I am running the final verification tests under both URI shapes.
### Root Cause Diagnosis

The remaining 31 test failures under a pathless `MONGODB_URI` (`mongodb://localhost:27017`) were traced to two issues:

1. **Remaining regex URI replacements**:
   The pattern `uri.replace(/\/[^/?]+(\?|$)/, '/' + dbName + '$1')` was still present in three locations that were not updated in commit `d54eff0`:
   - [`src/testing/TestHelpers.ts`](file:///home/ubuntu/code/mesh/src/testing/TestHelpers.ts#L119-L134) in `dropTestCollection()`
   - [`src/__tests__/supervisor/Supervisor.spec.ts`](file:///home/ubuntu/code/mesh/src/__tests__/supervisor/Supervisor.spec.ts#L182-L206) in the `describe('Supervisor.runTests() — real isolated test runs')` block
   - [`src/__tests__/core/ServiceBroker.spec.ts`](file:///home/ubuntu/code/mesh/src/__tests__/core/ServiceBroker.spec.ts#L371-L384) in the mount-keyed database isolation test

   When given a URI without a path (e.g. `mongodb://localhost:27017`), this regex matched `/localhost:27017` and replaced the host authority with the database name (`mongodb://mesh_test_xxxxxx`), causing driver timeouts during connection.

2. **Time series collection initialization race condition**:
   In [`src/db/Database.ts`](file:///home/ubuntu/code/mesh/src/db/Database.ts#L70-L108), `tsRepo()` triggered `ensureTimeSeriesCollection()` asynchronously without returning or chaining the promise to repository operations. When rapid consecutive operations occurred across test suites, writes (`insertMany`) raced against background collection creation (`createCollection`), causing MongoDB to intermittently report `Namespace ... is a view, not a collection`.

---

### Solution

- Replaced all remaining regex URI substitutions with [`withTestDatabase()`](file:///home/ubuntu/code/mesh/src/testing/TestHelpers.ts#L42-L46) across `TestHelpers.ts`, `Supervisor.spec.ts`, and `ServiceBroker.spec.ts`.
- Re-exported `withTestDatabase` from [`src/__tests__/helpers/setup.ts`](file:///home/ubuntu/code/mesh/src/__tests__/helpers/setup.ts#L82).
- Updated [`TimeSeriesRepository`](file:///home/ubuntu/code/mesh/src/db/TimeSeriesRepository.ts) and [`Database.ts`](file:///home/ubuntu/code/mesh/src/db/Database.ts#L80-L110) to pass and await the collection initialization readiness promise before executing collection operations (`insert`, `query`, `latest`, `aggregate`), while cleanly ignoring `NamespaceExists` errors on concurrent creation.

---

### Verification

All 31 test suites and 299 tests pass under both URI shapes:

```bash
MONGODB_URI=mongodb://localhost:27017 npm test
# Test Suites: 31 passed, 31 total
# Tests:       299 passed, 299 total

MONGODB_URI=mongodb://localhost:27017/mesh_test npm test
# Test Suites: 31 passed, 31 total
# Tests:       299 passed, 299 total
```

---

### Pull Request & Issue Tracking

- Branch pushed: `tony/6-mesh-tests`
- Pull Request opened: [FLYBYME/mesh#2](https://github.com/FLYBYME/mesh/pull/2)
- Comment posted on tracking issue: [FLYBYME/surfdns#6](https://github.com/FLYBYME/surfdns/issues/6#issuecomment-5486329193)
