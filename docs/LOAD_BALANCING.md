# Load Balancing Specification

## Overview
Load balancing in Mesh is performed at the edge of the service call. Before a request is sent to the network, the `ServiceRegistry` uses a balancer to select the most appropriate node from the pool of available providers.

## Balancing Strategies

### 1. Round Robin (`RoundRobinBalancer`)
The default strategy. It cycles through available nodes sequentially.
- **Stateful**: Maintains an internal counter per `action`.
- **Memory Protection**: Automatically clears counters when the number of unique actions exceeds 1000.

### 2. Latency Aware (`LatencyBalancer`)
Routes traffic to the node with the lowest recorded Round Trip Time (RTT).
- **Smoothing**: Uses an Exponential Moving Average (alpha = 0.2) to prevent oscillation caused by transient network spikes.
- **Defaulting**: Nodes without recorded latency are assigned a high default value (9999ms) to prioritize known-good nodes.

### 3. CPU Usage (`CpuUsageBalancer`)
Optimizes for compute resource availability.
- **Metrics**: Nodes report their current CPU load in heartbeats.
- **Selection**: Picks the node with the lowest reported percentage.

### 4. Health Aware (`HealthAwareBalancer`)
A sophisticated strategy that combines CPU and Active Request metrics.
- **Health Score**: Calculated as `1.0 - (cpu / 100) - (requests / 50)`.
- **Top-N Selection**: To avoid the "thundering herd" problem, it identifies the top 3 healthiest nodes and selects one of them randomly.

### 5. Shard Balancer (`ShardBalancer`)
Ensures that requests with the same `shardKey` (e.g., `userID`) are consistently routed to the same node.
- **Hashing**: Uses consistent hashing on the `shardKey`.
- **Affinity**: Ideal for stateful services or caching layers.

## Selection Logic
The `ServiceRegistry.selectNode` method follows this priority:
1. **Prefer Local**: If the service is available on the local node, it is selected immediately (zero network overhead).
2. **Filtering**: Exclude nodes that are marked as unavailable or in a different namespace.
3. **Balancing**: Pass the remaining candidates to the active balancer.

## Manual Overrides
Developers can bypass the balancer by specifying a `nodeID` in the `call` options:
```typescript
await app.call('math.add', { a: 1, b: 2 }, { nodeID: 'node-xyz' });
```
