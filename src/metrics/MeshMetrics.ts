import { MetricsRegistry, type BoundCounter, type BoundHistogram, type Counter, type Histogram } from './MetricsRegistry.js';

/**
 * MeshMetrics: the mesh's own instruments, on one MetricsRegistry.
 *
 * Browser-safe on purpose -- ServiceBroker and BaseTransport record into it, and both are in the
 * browser bundle. What only a Node process can measure (event loop delay, CPU, memory) lives in
 * `nodeMetrics.ts`, exported from `@flybyme/mesh/node` only.
 *
 * One process-wide instance, `meshMetrics`, is what the broker and transports record into by
 * default: a mesh-serve process runs one node, and a scrape is of the process. A test that stands
 * up several nodes in one process gives each its own `new MeshMetrics()` (broker.metrics,
 * transport.metrics) when it needs to tell them apart.
 */

/** How a call ended. `timeout` is the broker's own RPC timer firing, not a handler's error. */
export type RpcOutcome = 'ok' | 'error' | 'timeout';

export type PacketDirection = 'in' | 'out';

/**
 * A packet's kind as a label: `request`, `response` (both RESPONSE and RESPONSE_ERROR) or `event`
 * (everything else -- events, gossip, streams). With `topic` it separates an action's request
 * bytes from its response bytes, which differ by orders of magnitude for a `find`.
 */
export type PacketKind = 'request' | 'response' | 'event';

export function packetKind(type: string | undefined): PacketKind {
    if (type === 'REQUEST') return 'request';
    if (type === 'RESPONSE' || type === 'RESPONSE_ERROR') return 'response';
    return 'event';
}

/**
 * Seconds. From a sub-millisecond local read up to the 30 s where a call is certainly broken; the
 * 2-13 s calls seen on 2026-09-30 land in distinct buckets.
 */
export const RPC_DURATION_BUCKETS: readonly number[] = [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

/** The action label for a call to something this node does not know -- see ServiceBroker.recordHandled. */
export const UNKNOWN_ACTION = 'unknown';

export class MeshMetrics {
    public readonly rpcCalls: Counter;
    public readonly rpcDuration: Histogram;
    public readonly rpcOutgoing: Counter;
    public readonly rpcOutgoingDuration: Histogram;
    public readonly transportBytes: Counter;
    public readonly transportPackets: Counter;

    constructor(public readonly registry: MetricsRegistry = new MetricsRegistry()) {
        this.rpcCalls = registry.counter(
            'mesh_rpc_calls_total',
            'Calls this node handled (local and from the network), by action and outcome.',
            ['action', 'outcome'],
        );
        this.rpcDuration = registry.histogram(
            'mesh_rpc_duration_seconds',
            'Time to handle a call on this node, middleware and output validation included.',
            ['action'],
            RPC_DURATION_BUCKETS,
        );
        this.rpcOutgoing = registry.counter(
            'mesh_rpc_outgoing_total',
            'Calls this node sent to another node, by action and outcome.',
            ['action', 'outcome'],
        );
        this.rpcOutgoingDuration = registry.histogram(
            'mesh_rpc_outgoing_duration_seconds',
            'Round trip of a call this node sent to another node, until its response or timeout.',
            ['action'],
            RPC_DURATION_BUCKETS,
        );
        this.transportBytes = registry.counter(
            'mesh_transport_bytes_total',
            'Serialized mesh packet bytes over the WebSocket transport, by direction, packet kind and topic (an RPC\'s topic is its action).',
            ['direction', 'kind', 'topic'],
        );
        this.transportPackets = registry.counter(
            'mesh_transport_packets_total',
            'Mesh packets over the WebSocket transport, by direction, packet kind and topic. A broadcast counts once per peer it went to.',
            ['direction', 'kind', 'topic'],
        );
    }

    recordHandled(action: string, outcome: RpcOutcome, seconds: number): void {
        this.callBinding(this.handled, this.rpcCalls, this.rpcDuration, action).record(outcome, seconds);
    }

    recordOutgoing(action: string, outcome: RpcOutcome, seconds: number): void {
        this.callBinding(this.outgoing, this.rpcOutgoing, this.rpcOutgoingDuration, action).record(outcome, seconds);
    }

    /**
     * `bytes` is the length of what was (or will be) written to, or read from, the socket -- a
     * length the transport already has. Never serialize just to count.
     */
    recordPacket(direction: PacketDirection, kind: PacketKind, topic: string, bytes: number, packets = 1): void {
        const byTopic = this.packets[direction][kind];
        let binding = byTopic.get(topic);
        if (binding === undefined) {
            const labels = [direction, kind, topic];
            if (byTopic.size >= MAX_BINDINGS) {
                // Past the cap nothing more is cached; the registry's own series cap still applies.
                this.transportBytes.inc(labels, bytes);
                this.transportPackets.inc(labels, packets);
                return;
            }
            binding = { bytes: this.transportBytes.bind(labels), packets: this.transportPackets.bind(labels) };
            byTopic.set(topic, binding);
        }
        binding.bytes.inc(bytes);
        binding.packets.inc(packets);
    }

    // ── Bound series, per label set ──────────────────────────────────────────────────────────
    // Every packet and every call records something, so the label-set lookup is cached here by the
    // values the caller already holds (a topic string, an action name) instead of joined into a
    // key each time. Nested by direction/kind as plain properties so no key is ever built.
    private readonly packets: Record<PacketDirection, Record<PacketKind, Map<string, PacketBinding>>> = {
        in: { request: new Map(), response: new Map(), event: new Map() },
        out: { request: new Map(), response: new Map(), event: new Map() },
    };
    private readonly handled = new Map<string, CallBinding>();
    private readonly outgoing = new Map<string, CallBinding>();

    private callBinding(cache: Map<string, CallBinding>, calls: Counter, duration: Histogram, action: string): CallBinding {
        const cached = cache.get(action);
        if (cached !== undefined) return cached;
        const binding = new CallBinding(calls, duration, action);
        if (cache.size < MAX_BINDINGS) cache.set(action, binding);
        return binding;
    }
}

/** Label sets cached per cache map before new ones go through the unbound path. */
const MAX_BINDINGS = 2000;

interface PacketBinding {
    readonly bytes: BoundCounter;
    readonly packets: BoundCounter;
}

/** One action's call counters (bound lazily per outcome) and duration histogram. */
class CallBinding {
    private readonly byOutcome: Partial<Record<RpcOutcome, BoundCounter>> = {};
    private readonly duration: BoundHistogram;

    constructor(private readonly calls: Counter, duration: Histogram, private readonly action: string) {
        this.duration = duration.bind([action]);
    }

    record(outcome: RpcOutcome, seconds: number): void {
        let counter = this.byOutcome[outcome];
        if (counter === undefined) {
            counter = this.calls.bind([this.action, outcome]);
            this.byOutcome[outcome] = counter;
        }
        counter.inc();
        this.duration.observe(seconds);
    }
}

/** The process-wide instance -- see the file comment. */
export const meshMetrics = new MeshMetrics();

/** Seconds since `startedMs` (a `performance.now()` reading). */
export function secondsSince(startedMs: number): number {
    return (performance.now() - startedMs) / 1000;
}
