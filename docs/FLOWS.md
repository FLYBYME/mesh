# System Interaction Flows

## 1. Remote RPC Call Sequence

This diagram shows the complete logical and physical path of a `call()` crossing network boundaries, emphasizing interceptor injection and tracing context propagation.

```mermaid
sequenceDiagram
    participant User
    participant BrokerA as ServiceBroker (Node A)
    participant RegistryA as ServiceRegistry (Node A)
    participant NetworkA as MeshNetwork (Node A)
    participant TransportB as Transport (Node B)
    participant BrokerB as ServiceBroker (Node B)
    participant ServiceB as TargetService (Node B)

    User->>BrokerA: call("math.add", {a:1, b:2})
    Note over BrokerA: 1. Validate parameters using Zod<br/>2. Retrieve ContextStack (traceId, spanId)
    BrokerA->>RegistryA: selectNode("math.add")
    RegistryA-->>BrokerA: Target Node B
    
    BrokerA->>NetworkA: send(packet, target: Node B)
    Note over NetworkA: Execute Outbound Pipeline:<br/>1. LogInterceptor (Trace)<br/>2. Inject meta.traceId & meta.spanId
    
    NetworkA->>TransportB: Encoded Payload (JSON/WebSocket)
    
    TransportB->>BrokerB: handleIncomingRPC(packet)
    Note over BrokerB: Execute Inbound Pipeline:<br/>1. LogInterceptor (Trace)<br/>2. Extract tracing meta<br/>3. Execute local middlewares
    
    BrokerB->>ServiceB: handler({params: {a:1, b:2}})
    ServiceB-->>BrokerB: Result: 3
    
    BrokerB->>TransportB: send(RESPONSE, id: correlationID)
    TransportB-->>NetworkA: Encoded Response Payload
    
    NetworkA->>BrokerA: Resolve pendingRequest[correlationID]
    Note over BrokerA: Clear request timeout timer
    BrokerA-->>User: 3
```

### Trace Context Propagation
To trace requests across multiple distributed hops, the `ServiceBroker` propagates a tracing header block via packet metadata:
* **`traceId`**: Persistent identifier for the root request. Remains identical across all child RPC hops.
* **`spanId`**: Unique identifier for the current execution step.
* **`parentId`**: The `spanId` of the caller context. Used to reconstruct call trees.

---

## 2. Peer Discovery & DHT Join Flow

When a new node joins a cluster, it must announce its local services and learn about other peers.

```mermaid
stateDiagram-v2
    [*] --> Bootstrap : Node A starts with Bootstrap Node B URL
    Bootstrap --> Handshake : Establishes WebSocket to Node B
    Handshake --> RegistryUpdate : Sends NodeInfo (services, addresses)
    RegistryUpdate --> DHT_Insert : Node B computes XOR distance, places Node A in bucket
    DHT_Insert --> Gossip : Node B broadcasts NodeInfo to active peers (Node C, D)
    Gossip --> NetworkConvergence : Peers connect back to Node A to sync registries
    NetworkConvergence --> [*] : Cluster stable
```

1. **Bootstrap Handshake**: Node A opens a socket to the bootstrap peer (Node B) and transmits a packet containing its full `NodeInfo` (supported transports, namespaces, services, and tool capabilities).
2. **Registry Insertion**: Node B registers Node A locally, generating a `'changed'` event to notify local listeners.
3. **DHT Allocation**: Node B calculates the binary XOR distance and places Node A in the corresponding bucket.
4. **Active Gossip Broadcast**: Node B acts as a relay, flooding Node A's presence packet to its immediate peers.
5. **Direct Connect**: Peers (like Node C) receive the announcement, insert Node A into their registries, and establish direct WebSockets to Node A, achieving network convergence.

---

## 3. Event Flooding (Pub/Sub) Mechanics

To broadcast event messages without centralized message brokers, Mesh uses a flooding protocol. Loop prevention is managed through packet identification and Time-To-Live (TTL) boundaries.

```mermaid
flowchart TD
    Start[Event Emitted locally] --> Local[Trigger Local Emitters]
    Local --> IsGlobal{Global Broadcast?}
    
    IsGlobal -- Yes --> Send[Publish packet to all connected Peers]
    Send --> Peer[Peer Receives Packet]
    
    Peer --> Seen{Already Seen ID?}
    Seen -- Yes --> Drop[Drop Packet: Avoid infinite loop]
    
    Seen -- No --> Process[Store ID in seenPackets Map]
    Process --> LocalDispatch[Trigger local event listeners]
    LocalDispatch --> TTLCheck{Is TTL > 1?}
    
    TTLCheck -- Yes --> Dec[Decrement TTL by 1]
    Dec --> Forward[Forward event packet to adjacent peers]
    Forward --> Peer
    
    TTLCheck -- No --> End[Drop: TTL Expired]
```

---

## 4. Circuit Breaker State Transitions

The circuit breaker prevents cascading cluster failures by monitoring RPC error rates. It implements a finite state machine:

```mermaid
stateDiagram-v2
    [*] --> CLOSED : Normal operation
    CLOSED --> OPEN : N consecutive failures (default: 5)
    OPEN --> HALF_OPEN : Cool-off timeout elapsed (default: 30s)
    
    HALF_OPEN --> CLOSED : Trial request succeeds
    HALF_OPEN --> OPEN : Trial request fails (resets cool-off timer)
```

* **`CLOSED` (Normal)**: All traffic is routed directly to the transport layer.
* **`OPEN` (Tripped)**: The remote node is failing. The outbound pipeline intercepts outgoing requests to the failing node and raises an immediate `Circuit open` error locally, avoiding network timeouts.
* **`HALF_OPEN` (Recovery Trial)**: A single trial request is permitted through the network:
  * **Success**: The remote node is deemed healthy; state returns to `CLOSED` and the failure counter is reset.
  * **Failure**: The breaker immediately returns to `OPEN` and resets the 30-second cool-off timer.
