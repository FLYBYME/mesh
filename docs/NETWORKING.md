# Mesh Networking Specification

## Overview
The `MeshNetwork` component is responsible for low-level packet handling, peer-to-peer communication, and reliable message delivery across multiple transports. It abstracts the physical network into a logical event bus.

## Packet Lifecycle
1. **Creation**: `ServiceBroker` or `MeshNetwork` creates an `IMeshPacket`.
2. **Outbound Interceptors**: Packet passes through interceptors (e.g., Trace, Compression).
3. **Transport Selection**: `TransportManager` selects the best protocol for the target node.
4. **Transmission**: Packet is serialized and sent over the wire.
5. **Deduplication**: Receiving node checks if the packet ID has been seen before.
6. **Inbound Interceptors**: Packet passes through inbound interceptors (e.g., Decompression, Rate Limit).
7. **Dispatch**: Packet is routed to the local handler.

## Key Features

### 1. Packet Deduplication (Phase 1)
To prevent event loops and redundant processing, the network maintains a TTL-based cache of seen packet IDs (`seenPackets`).
- **TTL**: 10 seconds (default).
- **Exceptions**: `RESPONSE` and `RESPONSE_ERROR` packets skip deduplication to allow ID reuse between request and response.

### 2. Controlled Event Flooding (Phase 2)
Mesh uses a gossip-style mechanism for event propagation:
- **TTL**: Packets have a `ttl` field (default 5) that decrements on every hop.
- **Path Tracking**: Nodes append their `nodeID` to the `meta.path` to avoid sending packets back to nodes that already processed them.
- **Loop Suppression**: Packets originating from the local node are never processed if they arrive back through a transport.

### 3. Namespace Isolation
Nodes only process packets that match their `namespace` (default: 'default'). This allows running multiple logical clusters on the same physical infrastructure.

### 4. Transport Manager
Manages a collection of protocol implementations:
- **WS**: Primary for Browser/Server communication.
- **TCP**: High-speed Node-to-Node.
- **NATS**: Pub/Sub based transport for cloud environments.
- **Mock**: In-memory transport for unit testing.

## Packet Schema
```typescript
interface IMeshPacket<T = unknown> {
    id: string;             // Unique Message ID
    topic: string;          // Action name or Event topic
    type: 'REQUEST' | 'RESPONSE' | 'RESPONSE_ERROR' | 'EVENT';
    data: T;                // Payload
    senderNodeID: string;
    targetNodeID?: string;
    namespace?: string;
    timestamp: number;
    version: number;
    priority: number;       // 1 (Normal), 2 (System/Raft)
    meta: {
        ttl: number;
        path: string[];
        correlationID?: string;
    };
}
```

## Resilience
- **Automatic Reconnection**: Transports attempt to reconnect to peers if a socket drops.
- **Heartbeat Propagation**: Registry heartbeats are automatically piggybacked or refreshed on every inbound packet.
