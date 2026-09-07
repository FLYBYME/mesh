I have completed the task.

### Summary of Work

1. **Investigation & Measured Baselines**:
   - Clean disconnects were already handled immediately via `TransportManager`'s `peer:disconnect` and `MeshOrchestrator.handlePeerDisconnect`.
   - Unclean disconnects (dropped connection without FIN/RST) previously took **35,000 ms (35s)** under default settings (`ttl: 30000`, hardcoded 5000ms sweep interval in [`Registry.ts`](file:///home/ubuntu/code/mesh-dispatch-7/src/core/Registry.ts)) to be marked offline (`available: false`), and **65,000 ms** to be deleted.
   - Lowering `ttl` to `2000` alone still took **5,000 ms (5s)** to be detected due to the hardcoded `5000` interval, and because `5000 > 2 * 2000`, the node was deleted directly without ever being observed as unavailable.
   - In [`WSTransport.ts`](file:///home/ubuntu/code/mesh-dispatch-7/src/transports/node/WSTransport.ts), sockets killed without close frames were never terminated by the transport because `pong` was a no-op and there was no timeout mechanism.

2. **Mechanism Implemented**:
   - **WebSocket ping/pong keepalive timeout** in [`WSTransport.ts`](file:///home/ubuntu/code/mesh-dispatch-7/src/transports/node/WSTransport.ts): Configurable via `pingIntervalMs` and `pingTimeoutMs` on both incoming and outgoing connections. On missed pong within the timeout window, `ws.terminate()` terminates the socket, triggering immediate `peer:disconnect` and registry unregistration in **<= 2 seconds** without registry gossip.
   - **Derived Registry sweep interval** in [`Registry.ts`](file:///home/ubuntu/code/mesh-dispatch-7/src/core/Registry.ts) and [`RegistryModule.ts`](file:///home/ubuntu/code/mesh-dispatch-7/src/modules/RegistryModule.ts): Prune interval is now configurable via `pruneInterval` and derived as `Math.min(5000, Math.max(100, Math.floor(ttl / 2)))`. Preserves the 5000ms default for 30s TTL, while ensuring short TTLs (e.g. 2000ms -> 1000ms sweep) maintain the two-phase lifecycle (unavailable at `> ttl`, deleted at `> ttl * 2`).
   - Default configurations were kept non-aggressive for large meshes.

3. **Deliverables & Verification**:
   - Added [`NodeLoss.spec.ts`](file:///home/ubuntu/code/mesh-dispatch-7/src/__tests__/core/NodeLoss.spec.ts) covering baseline 35s sweep, short TTL sweep derivation, heartbeat recovery, transport ping/pong timeout detection in <= 2s, and the full end-to-end chain with [`MeshNetwork`](file:///home/ubuntu/code/mesh-dispatch-7/src/core/MeshNetwork.ts).
   - All 38 test suites and 415 tests pass (`npm test`).
   - TypeScript build succeeds (`npm run build`).
   - Branch pushed to `origin/frank/41-fast-node-loss`.
   - PR created: https://github.com/FLYBYME/mesh/pull/5
   - Plan and closing comments posted on [FLYBYME/surfdns#41](https://github.com/FLYBYME/surfdns/issues/41).

— frank

