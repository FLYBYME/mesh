# Resilience & Fault Tolerance Guide

## 1. Request Resiliency

### Timeouts
Every RPC call in Mesh has a mandatory timeout.
- **Default**: 10,000ms.
- **Configuration**: Can be set per action in the schema or per call in options.
- **Enforcement**: Managed by `ServiceBroker` using `SafeTimer`. If a response doesn't arrive, the promise rejects with `RPC_TIMEOUT`.

### Circuit Breakers
Implemented at the `MeshNetwork` interceptor level.
- **Trigger**: 5 consecutive errors to the same target node.
- **Effect**: Stops sending packets to that node for 30s.
- **Recovery**: Transitions to `HALF_OPEN` to test node health with a single request.

### Retries (Future Implementation)
- **Automatic**: Retries on network-level failures (e.g., connection reset).
- **Manual**: Developers can wrap calls in a retry loop using the `IMeshAuthMeta.retryCount` metadata.

## 2. Cluster Resiliency

### Split Brain Protection
Mesh utilizes namespaces and the Kademlia DHT to maintain cluster integrity.
- **Namespace Isolation**: Nodes from different namespaces cannot discover each other.
- **Node Eviction**: If a node stops heartbeating, the `ServiceRegistry` marks it as `unavailable` after 10s and purges it after 30s.

### Partition Tolerance
In the event of a network partition:
- Nodes in partition A will continue to communicate.
- Nodes in partition B will continue to communicate.
- Once the partition heals, the `MeshOrchestrator` will re-merge the registries via the bootstrap nodes.

## 3. Resource Resilience

### Rate Limiting
Protects a node from being overwhelmed by a single client or peer.
- **Scope**: Applied per `senderNodeID`.
- **Limit**: Defaults to 1000 packets per 60s window.
- **Action**: Excessive packets are silently dropped to preserve CPU for healthy traffic.

### Memory Protection
- **Deduplication Cache**: Limits the `seenPackets` Map with a 10s TTL.
- **Balancer Counters**: `RoundRobinBalancer` resets its counters if they exceed 1000 unique action keys.
- **Registry Size**: The registry can be configured with a maximum node count to prevent OOM in massive environments.

## 4. Error Hierarchy

| Code | Meaning | Recovery |
|---|---|---|
| `MESH_DISCOVERY_ERROR` | Service not found in registry | Check service spelling or start provider |
| `RPC_TIMEOUT` | No response within deadline | Increase timeout or check node load |
| `CIRCUIT_OPEN` | Node is currently blacklisted | Wait 30s for auto-reset |
| `VALIDATION_ERROR` | Parameters don't match Zod schema | Check caller parameters |
| `TRANSPORT_ERROR` | Physical connection failed | Auto-reconnect will attempt repair |
