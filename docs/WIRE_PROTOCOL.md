# Wire Protocol & Framing Specification

## 1. Packet Anatomy
Every message sent over a Mesh transport follows this structure.

### Binary Header (Optional for TCP)
If using `TCPTransport`, the packet is prefixed with a 4-byte big-endian integer representing the length of the following JSON/Protobuf payload.

### The Envelope (JSON Representation)
```json
{
  "id": "mesh_abc123",
  "topic": "service.action",
  "type": "REQUEST",
  "data": { ... },
  "senderNodeID": "node_server_1",
  "targetNodeID": "node_worker_2",
  "namespace": "prod",
  "timestamp": 1716674400,
  "version": 1,
  "priority": 1,
  "meta": {
    "ttl": 5,
    "path": ["node_server_1"],
    "correlationID": "orig_request_789",
    "traceId": "t-123",
    "compressed": true
  }
}
```

## 2. Packet Types
- **`REQUEST`**: Expects a response. Uses `id` for tracking.
- **`RESPONSE`**: Successful result of a request. `meta.correlationID` must match original `id`.
- **`RESPONSE_ERROR`**: Failed result. `data` is replaced by an `error` object.
- **`EVENT`**: Fire-and-forget. Propagated via flooding.

## 3. Serialization Rules

### Isomorphic JSON (`JSONSerializer`)
- **Strings/Numbers/Booleans**: Standard JSON.
- **Buffers (Node.js)**: Encoded as `{ "type": "Buffer", "data": [byte, byte, ...] }`.
- **Uint8Array (Browser)**: Decoded from the JSON Buffer representation back into `Uint8Array`.

### Binary (Future `BinarySerializer`)
- **Field 1 (Varint)**: Version
- **Field 2 (String)**: ID
- **Field 3 (Byte)**: Type (0=Req, 1=Res, etc.)
- ...

## 4. Framing Strategies

### WebSockets
- Each Mesh packet is sent as a single WebSocket message (Binary or Text frame).
- Multi-packet fragmentation is handled by the browser/engine.

### TCP
- **Streaming**: TCP is a stream, not a packet protocol.
- **Delimiter**: Mesh uses a **Length-Prefix** (4 bytes).
- **Process**:
  1. Read 4 bytes.
  2. Parse as `Uint32BE`.
  3. Wait for exactly `N` bytes of data.
  4. Pass `N` bytes to the Serializer.

### NATS
- Each Mesh packet is the payload of a NATS message.
- Subject format: `mesh.<namespace>.<topic>` or `node.<nodeID>`.

## 5. Metadata Propagation
Metadata keys starting with `_` are reserved for internal use. User metadata should be placed in `meta.custom`.
- `meta.ttl`: Initialized to 5, dropped at 0.
- `meta.path`: Array of visited NodeIDs. Max length 10.
