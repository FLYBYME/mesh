# P2P Networking & Discovery

## Network Stack Overview

The networking layer is composed of five cooperating classes:

| Class | File | Responsibility |
|---|---|---|
| `MeshNetwork` | [MeshNetwork.ts](file:///home/ubuntu/code/mesh/src/core/MeshNetwork.ts) | Top-level network facade: packet send/receive, interceptors, deduplication |
| `TransportManager` | [TransportManager.ts](file:///home/ubuntu/code/mesh/src/core/TransportManager.ts) | Manages multiple transport backends (currently WebSocket) |
| `NetworkDispatcher` | [NetworkDispatcher.ts](file:///home/ubuntu/code/mesh/src/core/NetworkDispatcher.ts) | Routes incoming packets to registered topic handlers |
| `NetworkController` | [NetworkController.ts](file:///home/ubuntu/code/mesh/src/core/NetworkController.ts) | Handles system-level packets (`$node.ping`, `$node.pex`, `$node.presence`, etc.) |
| `MeshOrchestrator` | [MeshOrchestrator.ts](file:///home/ubuntu/code/mesh/src/core/MeshOrchestrator.ts) | Gossip protocol, presence broadcasting, peer exchange (PEX), bootstrap |

---

## Packet Format

Every message on the wire is a `MeshPacket`:

```typescript
interface MeshPacket<T = unknown> {
    id: string;                     // Unique packet ID
    topic: string;                  // Routing key (tool name or system topic)
    data: T;                        // Payload
    error?: { message, code?, data? }; // Error payload (for RESPONSE_ERROR)
    type: 'EVENT' | 'REQUEST' | 'RESPONSE' | 'RESPONSE_ERROR';
    senderNodeID: string;           // Originating node
    targetNodeID?: string;          // Specific destination (undefined = broadcast)
    namespace: string;              // Namespace isolation
    timestamp: number;              // Unix ms
    version: number;                // Protocol version
    priority: number;               // 1 = normal, 2 = protocol (raft/kademlia)
    meta: {
        ttl?: number;               // Hop limit
        path?: string[];            // Nodes this packet has traversed
        correlationID?: string;     // For request/response pairing
        timeout?: number;           // RPC timeout hint
        traceId?: string;           // Distributed tracing
        spanId?: string;
        parentId?: string;
    }
}
```

---

## Packet Processing Pipeline

When a packet arrives from a transport:

### 1. Loopback Suppression

Packets from `this.nodeID` are silently dropped. The `ServiceBroker` already handles local delivery directly — network packets from self are duplicates caused by broadcast.

### 2. Namespace Isolation

If the packet's `namespace` differs from the local node's namespace, it is dropped. This allows multiple logical networks to share the same physical transport.

### 3. Deduplication

Non-response packets are checked against a `seenPackets` map (keyed by `packet.id`). If already seen within the TTL window (10 seconds), the packet is dropped. Response packets skip deduplication because request and response share the same correlation ID.

### 4. Heartbeat Refresh

Every accepted packet refreshes the sender's heartbeat in the `Registry`, preventing the sender from being pruned as stale.

### 5. Interceptor Chain

Inbound interceptors (e.g. circuit breakers) process the packet in reverse registration order via `interceptor.onInbound(packet)`.

### 6. Generic Handlers

The packet is dispatched to the `ServiceBroker`'s wildcard handler (registered via `network.onMessage('*', ...)`). This is where the broker processes `REQUEST`, `RESPONSE`, `RESPONSE_ERROR`, and `EVENT` packets.

### 7. Specific Handlers

The packet is dispatched through the `NetworkDispatcher` to topic-specific handlers (registered by `NetworkController`).

---

## Outbound Packet Processing

When sending via `network.send(targetNodeID, topic, data, options)`:

1. A `MeshPacket` is constructed with the sender's node ID, namespace, version, and priority
2. Protocol topics (`raft.*`, `kademlia.*`) get elevated priority (2)
3. Each outbound interceptor's `onOutbound(packet)` is called in registration order
4. If any interceptor rewrites the topic to `__circuit_open`, the send throws immediately (circuit breaker)
5. The packet is handed to `TransportManager.send(nodeID, packet)`

Broadcasting (`targetNodeID = '*'`) uses `network.publish()` instead, which broadcasts to all connected peers.

---

## MeshOrchestrator — Gossip & Discovery

[MeshOrchestrator.ts](file:///home/ubuntu/code/mesh/src/core/MeshOrchestrator.ts) is the gossip protocol engine. It manages three periodic processes:

### Bootstrap

On startup, if `bootstrapNodes` are configured, the orchestrator iterates each URL and calls `node.connectToPeer(tempId, url)`. The transport establishes a WebSocket connection and the handshake resolves the actual node ID.

### Presence Broadcasting (every 15s)

The orchestrator publishes the local node's full `NodeInfo` (including all registered services, tools, and health metrics) to all peers via `$node.presence`. When a **new** node receives a presence packet from an unknown peer, it immediately sends its own presence back — this ensures bidirectional discovery.

Presence is also re-broadcast immediately whenever the local registry emits `local:changed` (e.g. when a new service module is registered).

### Gossip / Peer Exchange (every 10s)

The orchestrator selects a random available peer and publishes `$node.pex` with a random subset (up to 50) of known nodes. This propagates cluster knowledge even when nodes can't directly reach each other.

### Peer Connect / Disconnect

When the transport layer detects a new connection:
- `handlePeerConnect(nodeID)` sends both a targeted presence broadcast and a full PEX dump to the new peer

When a disconnect is detected:
- `handlePeerDisconnect(nodeID)` immediately removes the node from the registry

---

## NetworkController — System Packet Handlers

[NetworkController.ts](file:///home/ubuntu/code/mesh/src/core/NetworkController.ts) registers handlers for all system-level topics:

| Topic | Purpose |
|---|---|
| `$node.ping` | Refresh sender's heartbeat, reply with `$node.pong` |
| `$node.pong` | Refresh sender's heartbeat |
| `$node.pex` | Forward to `MeshOrchestrator.handlePEX()` to merge peer lists |
| `$node.presence` | Forward to `MeshOrchestrator.handlePresence()` to register/update the node |
| `$node.announce` | Legacy node announcement (registers basic node info) |
| `$rpc.request` | Debug logging for direct RPC |
| `$rpc.response` | Placeholder (responses are handled by correlation in broker) |

---

## Registry — Service Catalog

[Registry.ts](file:///home/ubuntu/code/mesh/src/core/Registry.ts) maintains the global view of all known nodes and their capabilities.

### Node Registration

Every node is stored as a `RegistryNodeInfo`:

```typescript
{
    nodeID: string,
    type: 'node',
    namespace: string,
    addresses: string[],         // WebSocket URLs
    services: ServiceInfo[],     // Each has a name and tools map
    available: boolean,
    timestamp: number,           // Last heartbeat
    nodeSeq: number,             // Monotonic version counter
    healthScore: number,         // 0.0 (overloaded) to 1.0 (ideal)
    cpu: number,                 // CPU usage percentage
    hostname: string,
    pid: number,
    trustLevel: 'internal' | 'public',
    capabilities: { transports, features },
    metadata: Record<string, unknown>,
}
```

**Sequence-based conflict resolution**: When a node registration arrives, if the existing `nodeSeq` is higher than the incoming one, the update is silently rejected. If equal, only the timestamp is refreshed. This prevents stale gossip from overwriting newer data.

### Tool Endpoint Resolution

`registry.selectNode(toolName)` finds the best node to handle a tool call:

1. Iterate all available nodes and their services
2. For each service, check if its `tools` map contains the requested tool name
3. Tool lookup supports both full keys (`sandbox.create`) and short keys (`create` within the `sandbox` service)
4. If `preferLocal` is true (default), the local node is always returned if it has the tool
5. Otherwise, pass all candidates through the `RoundRobinBalancer` to select a peer

### Stale Node Pruning (every 5s)

- Nodes with `timestamp` older than `ttl` (default 30s) are marked `available = false`
- Nodes older than `2 × ttl` (60s) are fully removed from the registry and DHT

### Local Metrics Update (every 10s)

The registry periodically updates the local node's CPU and memory metrics using `os.cpus()` and `process.memoryUsage()`. The `healthScore` is computed as:

```
healthScore = max(0, 1.0 - (cpu / 100) - (activeRequests / 50))
```

This feeds into load-aware routing decisions.

### Wait Helpers

The registry provides async wait methods for service discovery:

```typescript
await registry.waitForService('sandbox', 15000);
await registry.waitForTool('sandbox.create', 5000);
await registry.waitForNodes(3, 15000);
```

These subscribe to the `changed` event and resolve when the condition is met, or reject on timeout.

---

## Kademlia DHT

[KademliaRoutingTable.ts](file:///home/ubuntu/code/mesh/src/core/KademliaRoutingTable.ts) implements XOR-distance based node organization with 256 k-buckets (k=20 per bucket).

### Node ID Hashing

Node IDs are converted to 256-bit BigInt values by hex-encoding the string characters and padding to 64 hex digits.

### Bucket Assignment

XOR distance between the local node and a peer determines which bucket the peer belongs to. The bucket index is `floor(log2(distance))`.

### Node Lookup

`findClosestNodes(targetID, count)` scans outward from the target's bucket, collecting nodes sorted by ascending XOR distance.

### Tool Lookup

`findNodesForTool(toolName, count)` scans all buckets linearly for nodes whose services include the requested tool.

The DHT is optional — enable it via `new RegistryModule({ dhtEnabled: true })`. When disabled, the `Registry` uses flat iteration over all nodes (which is perfectly efficient for clusters under ~100 nodes).

---

## Load Balancing

[RoundRobinBalancer.ts](file:///home/ubuntu/code/mesh/src/balancers/RoundRobinBalancer.ts) extends `BaseBalancer` and cycles through candidate nodes in order. The balancer is used by `Registry.getNextToolEndpoint()` when multiple nodes offer the same tool.

Custom balancers can be installed via `registry.setBalancer(new MyBalancer())`.
