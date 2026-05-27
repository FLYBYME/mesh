# Mesh Transports Specification

## Overview
Transports are the protocol-specific drivers that handle the physical movement of packets between nodes. Mesh uses a modular transport system that allows swapping the underlying networking layer without changing the application logic.

## Base Class (`BaseTransport`)
Every transport must inherit from `BaseTransport` and implement the core lifecycle methods:
- `connect(options)`: Initialize the connection.
- `disconnect()`: Close the connection and clean up resources.
- `send(nodeID, packet)`: Point-to-point delivery.
- `publish(topic, packet)`: Broadcast/Multicast delivery.
- `start()` / `stop()`: Manage internal listeners.

## Implementations

### 1. WebSocket Transport (`WSTransport`)
The primary isomorphic transport.
- **Isomorphic**: Uses `ws` in Node.js and the native `WebSocket` API in the browser.
- **Mode**: Can act as both a Client and a Server (via `UnifiedServer`).
- **Heartbeats**: Built-in ping/pong to detect dead connections.

### 2. TCP Transport (`TCPTransport`)
High-performance server-to-server transport.
- **Node-only**: Uses the native `net` module.
- **Framing**: Uses `TCPFrameCodec` to handle packet boundary detection (Length-Prefixing).
- **Speed**: Lowest overhead for high-throughput RPC.

### 3. NATS Transport (`NATSTransport`)
Broker-based transport for cloud-native environments.
- **Pub/Sub**: Uses NATS subjects for routing (e.g., `mesh.<nodeID>`).
- **Scalability**: Decouples nodes from each other; nodes don't need direct IP connectivity.
- **Resilience**: Leverages NATS' built-in load balancing and persistence features.

### 4. Mock Transport (`MockTransport`)
In-memory transport for unit testing.
- **Static Registry**: Uses a static Map to track all instances in the process.
- **Simulated Latency**: Adds a small (5ms) delay to mimic real network behavior.

## Transport Manager
The `TransportManager` coordinates multiple transports:
1. **Selection**: It looks at a target node's `addresses` and selects the first transport that supports the address protocol (e.g., `tcp://` or `ws://`).
2. **Failover**: If the primary transport fails, it can attempt fallback to secondary addresses.
3. **Unified Interface**: Provides a single `send()` and `publish()` entry point for the `MeshNetwork`.

## Protocol Detection
```typescript
private getAddressType(address: string): TransportType {
    if (address.startsWith('tcp://')) return 'tcp';
    if (address.startsWith('ws://') || address.startsWith('wss://')) return 'ws';
    if (address.startsWith('nats://')) return 'nats';
    return 'ws'; // Default fallback
}
```
