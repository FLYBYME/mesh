# Wire Protocol & Framing Specification

## Overview
To communicate across distinct processes and network boundaries, Mesh relies on a strictly structured, high-performance wire protocol. Packets carry RPC calls, event propagation data, routing coordinates, namespaces, priorities, and distributed tracing metadata.

---

## 1. The `MeshPacket` TypeScript Structure

All packets conform to the isomorphic `MeshPacket` TypeScript interface:

```typescript
export interface MeshPacket<T = unknown> {
    id: string;                    // Unique packet identifier (UUID / NanoID)
    topic: string;                 // The service action name or event name (e.g. "math.add")
    type: 'REQUEST' | 'RESPONSE' | 'RESPONSE_ERROR' | 'EVENT';
    senderNodeID: string;          // Source Node ID
    targetNodeID?: string;         // Target Node ID (undefined for broadcast events)
    namespace: string;             // logical namespace boundary
    timestamp: number;             // Unix timestamp in ms
    version: number;               // Protocol version
    priority: number;              // Transmission priority queue index (1-3)
    data?: T;                      // Payload structure (undefined if error packet)
    error?: {                      // Error block (only present if type = 'RESPONSE_ERROR')
        message: string;
        code?: string | number;
        data?: unknown;
    };
    meta?: {                       // Protocol metadata envelope
        ttl?: number;              // Time-to-Live hops counter (default: 5)
        path?: string[];           // Peer hop path list for loop prevention
        correlationID?: string;    // Matches response packets back to caller requests
        traceId?: string;          // Distributed transaction trace ID
        spanId?: string;           // Current execution span ID
        parentId?: string;         // Parent span ID
        compressed?: boolean;      // Payload gzip compression indicator
        signature?: string;        // HMAC security packet signature
        [key: string]: unknown;
    };
}
```

---

## 2. Wire Representation Examples (JSON Format)

### `REQUEST` Packet
Initiates an RPC call. It expects a matching `RESPONSE` and contains tracking headers:

```json
{
  "id": "req-98765-ab",
  "topic": "math.add",
  "type": "REQUEST",
  "senderNodeID": "node-alpha",
  "targetNodeID": "node-beta",
  "namespace": "production",
  "timestamp": 1716674400234,
  "version": 1,
  "priority": 1,
  "data": {
    "a": 10,
    "b": 20
  },
  "meta": {
    "ttl": 5,
    "path": ["node-alpha"],
    "traceId": "trace-442211",
    "spanId": "span-553322"
  }
}
```

### `RESPONSE` Packet (Success)
Carries the result of a successful `REQUEST`. The `meta.correlationID` matches the original `REQUEST` packet's `id`:

```json
{
  "id": "req-98765-ab",
  "topic": "math.add",
  "type": "RESPONSE",
  "senderNodeID": "node-beta",
  "targetNodeID": "node-alpha",
  "namespace": "production",
  "timestamp": 1716674400245,
  "version": 1,
  "priority": 1,
  "data": 30,
  "meta": {
    "correlationID": "req-98765-ab",
    "traceId": "trace-442211",
    "parentId": "span-553322"
  }
}
```

### `RESPONSE_ERROR` Packet (Failure)
Sent when an RPC call fails. The `data` field is empty, and the `error` block is populated:

```json
{
  "id": "req-98765-ab",
  "topic": "math.add",
  "type": "RESPONSE_ERROR",
  "senderNodeID": "node-beta",
  "targetNodeID": "node-alpha",
  "namespace": "production",
  "timestamp": 1716674400248,
  "version": 1,
  "priority": 1,
  "error": {
    "message": "Division by zero is undefined.",
    "code": "MATH_EXECUTION_ERROR"
  },
  "meta": {
    "correlationID": "req-98765-ab",
    "traceId": "trace-442211"
  }
}
```

---

## 3. TCP Framing & Length-Prefixing

Because TCP is a stream-oriented protocol rather than a message-oriented protocol, data packets can arrive fragmented. To reconstruct complete packets, the `TCPTransport` prefixes each payload with a **4-byte big-endian length header** (`Uint32BE`).

```
+---------------------------+-----------------------------------------------+
|  Length Prefix (4 Bytes)  |         Serialized Packet Payload (N Bytes)   |
|  Uint32BE Big-Endian Int  |         (JSON String or Protobuf Bytes)       |
+---------------------------+-----------------------------------------------+
|  Example: 0x000000FA      |  {"id":"mesh_abc123","topic":"math.add",...}  |
|  (250 bytes data payload) |                                               |
+---------------------------+-----------------------------------------------+
```

### Stream Parsing Lifecycle
1. The receiver buffers incoming TCP chunks.
2. Once at least **4 bytes** are buffered, the receiver parses them as a `Uint32BE` integer to get length $N$.
3. The receiver waits until at least $N$ bytes have arrived.
4. Once $N$ bytes are in the buffer, they are sliced and passed to the `BaseSerializer` for decoding.
5. The parsed message is dispatched, and the buffer offset is updated to parse the next packet.
