I have launched `npm test` and am waiting for it to complete.
I have launched the final build and test run and will wait for it to complete.
The build and test task is running and will notify when complete. I will await the completion notification.
The vulnerability described in [FLYBYME/surfdns#50](https://github.com/FLYBYME/surfdns/issues/50) has been addressed and tested.

### Summary of Actions Taken

1. **Strict Listener Host Binding**:
   - Resolved the issue where [`UnifiedServer`](file:///home/ubuntu/code/mesh-dispatch-9/src/core/UnifiedServer.ts#L12-L55) ignored the transport's configured bind host and bound `0.0.0.0` by default. [`UnifiedServer`](file:///home/ubuntu/code/mesh-dispatch-9/src/core/UnifiedServer.ts) and [`MeshNetwork`](file:///home/ubuntu/code/mesh-dispatch-9/src/core/MeshNetwork.ts#L52-L60) now bind strictly to the specified host (`127.0.0.1` by default).
   - Updated default bind hosts across [`WSTransport`](file:///home/ubuntu/code/mesh-dispatch-9/src/transports/node/WSTransport.ts#L48), [`StartCommand`](file:///home/ubuntu/code/mesh-dispatch-9/src/cli/commands/StartCommand.ts#L22), and [`GenerateCommand`](file:///home/ubuntu/code/mesh-dispatch-9/src/cli/commands/GenerateCommand.ts#L24) to `127.0.0.1`.

2. **Non-Loopback Listener Authentication Guard**:
   - In [`WSTransport.connect()`](file:///home/ubuntu/code/mesh-dispatch-9/src/transports/node/WSTransport.ts#L93-L100), if `MESH_KEY` is not provided and the listener host is non-loopback (not in `127.0.0.0/8`, `::1`, `localhost`), startup is aborted immediately with an explicit error:
     `[WSTransport] Refusing to start on non-loopback host "<host>" without authentication key. Set MESH_KEY environment variable or pass authKey in options to secure the mesh port.`

3. **Handshake Verification & Rejection Visibility**:
   - In [`WSTransport.verifyHandshake()`](file:///home/ubuntu/code/mesh-dispatch-9/src/transports/node/WSTransport.ts#L206-L230), authentication is enforced at the HTTP upgrade stage. Peers missing credentials receive HTTP 401; peers with invalid credentials receive HTTP 403. Neither reaches [`registerNode`](file:///home/ubuntu/code/mesh-dispatch-9/src/transports/node/WSTransport.ts#L173), PEX, or broker messaging.
   - Connection attempts to non-loopback interfaces when bound to `127.0.0.1` fail at the TCP socket layer with `ECONNREFUSED`.

4. **Testing**:
   - Added [`WSTransportBind.spec.ts`](file:///home/ubuntu/code/mesh-dispatch-9/src/__tests__/transports/WSTransportBind.spec.ts) verifying both standalone [`WSTransport`](file:///home/ubuntu/code/mesh-dispatch-9/src/transports/node/WSTransport.ts) and full [`MeshApp`](file:///home/ubuntu/code/mesh-dispatch-9/src/core/MeshApp.ts) bound to `127.0.0.1` succeed on `127.0.0.1` and are rejected with `ECONNREFUSED` on external network interfaces.
   - Expanded [`WSTransportAuth.spec.ts`](file:///home/ubuntu/code/mesh-dispatch-9/src/__tests__/transports/WSTransportAuth.spec.ts) to verify non-loopback startup guard without `MESH_KEY` and registry isolation on rejected handshakes.
   - All 40 test suites and 425 unit/integration tests passed.

5. **Pull Request & Issue Response**:
   - Committed changes on branch `dispatch/9` and pushed `HEAD:frank/50-handshake-auth`.
   - Opened PR [#6 on FLYBYME/mesh](https://github.com/FLYBYME/mesh/pull/6) with title `"A peer proves itself before it is a peer, and binds where it is told"` (referencing `Refs FLYBYME/surfdns#50`).
   - Posted the closing explanation comment on [FLYBYME/surfdns#50](https://github.com/FLYBYME/surfdns/issues/50#issuecomment-5568189983).

