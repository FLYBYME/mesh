# Serialization Specification

## Overview
Serialization is the process of converting `IMeshPacket` objects and their payloads into binary formats for transmission over the wire. Mesh supports multiple serialization protocols, allowing for a balance between speed, payload size, and language compatibility.

## Base Class (`BaseSerializer`)
All serializers inherit from `BaseSerializer`:
- `serialize(data: any): Uint8Array`: Encodes a JavaScript object into a byte buffer.
- `deserialize(buffer: Uint8Array): any`: Decodes a byte buffer into a JavaScript object.

## Implementations

### 1. JSON Serializer (`JSONSerializer`)
The default and most flexible serializer.
- **Protocol**: Standard JSON stringified and encoded to UTF-8.
- **Isomorphic Support**: Handles `Buffer` objects by converting them to `{ type: 'Buffer', data: [...] }` to ensure they survive transmission to the browser (where native Node.js Buffers don't exist).
- **Pros**: Human-readable, native to JS, highly compatible.
- **Cons**: Large payload size, slower than binary formats.

### 2. Binary Serializer (`BinarySerializer`)
A optimized format for numerical and simple key-value data.
- **Protocol**: Uses a compact binary representation.
- **Isomorphic**: Utilizes `TypedArray` and `DataView` for platform-agnostic bit manipulation.
- **Pros**: Smaller footprint, faster for numerical data.

### 3. ProtoBuf Serializer (`ProtoBufSerializer`)
Strict, schema-based serialization using Google's Protocol Buffers.
- **Protocol**: Binary wire format.
- **Validation**: Ensures that outbound and inbound data strictly adheres to `.proto` definitions.
- **Pros**: Smallest payloads, cross-language support, schema evolution.
- **Cons**: Requires pre-defined schemas and code generation.

## Handling Isomorphism
Mesh's serialization layer is designed to bridge the gap between Node.js and the Browser:
- **Buffer vs. Uint8Array**: Automatically normalizes binary data types.
- **Encoder/Decoder**: Uses `TextEncoder` and `TextDecoder` for high-performance UTF-8 handling in all environments.

## Selection
The serializer is typically configured at the Transport level:
```typescript
const serializer = new JSONSerializer();
const transport = new WSTransport(serializer);
```

## Packet Envelope
Regardless of the serializer used for the `data` payload, the `IMeshPacket` envelope contains mandatory metadata (ID, Topic, SenderID) that allows the `MeshNetwork` to route the packet without necessarily knowing how to decode the payload.
