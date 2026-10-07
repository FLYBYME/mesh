import { MeshApp } from '../../core/MeshApp.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { NetworkModule } from '../../modules/NetworkModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { WSTransport } from '../../transports/node/WSTransport.js';
import { JSONSerializer } from '../../serializers/JSONSerializer.js';
import { ServiceBroker } from '../../core/ServiceBroker.js';
import { defineContract, defaultPrint } from '../../interfaces/IToolContract.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { MeshMetrics, UNKNOWN_ACTION } from '../../metrics/MeshMetrics.js';
import { MetricsRegistry } from '../../metrics/MetricsRegistry.js';
import { installNodeMetrics } from '../../metrics/nodeMetrics.js';
import { z } from 'zod';

declare global {
    interface IServiceToolRegistry {
        'metrics.echo': { params: { text: string }; returns: { text: string } };
        'metrics.fail': { params: Record<string, never>; returns: { ok: boolean } };
        'metrics.slow': { params: Record<string, never>; returns: { ok: boolean } };
        'metrics.relay': { params: { text: string }; returns: { text: string } };
    }
}

const FILE = 'src/__tests__/metrics/MeshInstrumentation.spec.ts';

const echo = defineContract({
    domain: 'metrics', action: 'echo', description: 'metrics.echo',
    inputSchema: z.object({ text: z.string() }), outputSchema: z.object({ text: z.string() }),
    filePath: FILE, concurrency: 'on-demand', permissions: [], print: defaultPrint, rest: { method: 'POST', path: '/metrics' },
});
const fail = defineContract({
    domain: 'metrics', action: 'fail', description: 'metrics.fail',
    inputSchema: z.object({}), outputSchema: z.object({ ok: z.boolean() }),
    filePath: FILE, concurrency: 'on-demand', permissions: [], print: defaultPrint, rest: { method: 'POST', path: '/metrics' },
});
const slow = defineContract({
    domain: 'metrics', action: 'slow', description: 'metrics.slow',
    inputSchema: z.object({}), outputSchema: z.object({ ok: z.boolean() }),
    filePath: FILE, concurrency: 'on-demand', permissions: [], print: defaultPrint, rest: { method: 'POST', path: '/metrics' },
    timeout: 100,
});

const relay = defineContract({
    domain: 'metrics', action: 'relay', description: 'metrics.relay: calls metrics.echo',
    inputSchema: z.object({ text: z.string() }), outputSchema: z.object({ text: z.string() }),
    filePath: FILE, concurrency: 'on-demand', permissions: [], print: defaultPrint, rest: { method: 'POST', path: '/metrics' },
});

/**
 * The instrumentation, end to end over a real WebSocket: a call handled on B is counted on B (and
 * only there), the same call is counted as outgoing on A, and both transports count the request and
 * response bytes under the action's topic. Each node records into its own MeshMetrics so the two
 * sides can be told apart in one process.
 */
describe('mesh self-metrics', () => {
    const logger = new Logger(LogLevel.ERROR);
    const serializer = new JSONSerializer();
    const metricsA = new MeshMetrics();
    const metricsB = new MeshMetrics();
    let appA: MeshApp;
    let appB: MeshApp;
    let brokerA: ServiceBroker;
    let brokerB: ServiceBroker;

    beforeAll(async () => {
        const transportA = new WSTransport(serializer, 6781, '127.0.0.1');
        transportA.metrics = metricsA;
        appA = new MeshApp({ nodeID: 'metrics-a', logger });
        appA.use(new RegistryModule());
        appA.use(new NetworkModule({ port: 6781, transports: [transportA] }));
        appA.use(new BrokerModule());
        await appA.start();

        const transportB = new WSTransport(serializer, 6782, '127.0.0.1');
        transportB.metrics = metricsB;
        appB = new MeshApp({ nodeID: 'metrics-b', logger });
        appB.use(new RegistryModule());
        appB.use(new NetworkModule({ port: 6782, transports: [transportB], bootstrapNodes: ['ws://127.0.0.1:6781'] }));
        appB.use(new BrokerModule());
        await appB.start();

        brokerA = appA.getProvider<ServiceBroker>('broker');
        brokerB = appB.getProvider<ServiceBroker>('broker');
        brokerA.metrics = metricsA;
        brokerB.metrics = metricsB;

        brokerB.registerContract(echo, async (args) => ({ text: args.text }));
        brokerB.registerContract(fail, async () => { throw new Error('nope'); });
        brokerB.registerContract(slow, async () => {
            await new Promise((resolve) => setTimeout(resolve, 400));
            return { ok: true };
        });

        await brokerA.registry.waitForTool('metrics.echo', 5000);
    }, 15000);

    afterAll(async () => {
        await appB?.stop();
        await appA?.stop();
    });

    it('counts a local call on the node that handled it', async () => {
        await brokerB.call('metrics.echo', { text: 'local' });

        expect(metricsB.rpcCalls.get(['metrics.echo', 'ok'])).toBe(1);
        expect(metricsB.rpcDuration.count(['metrics.echo'])).toBe(1);
        expect(metricsB.rpcOutgoing.get(['metrics.echo', 'ok'])).toBe(0);
    });

    it('counts a remote call as outgoing on the caller and handled on the callee, with its bytes by topic', async () => {
        const before = {
            handled: metricsB.rpcCalls.get(['metrics.echo', 'ok']),
            inB: metricsB.transportBytes.get(['in', 'request', 'metrics.echo']),
            outB: metricsB.transportBytes.get(['out', 'response', 'metrics.echo']),
        };

        const result = await brokerA.call('metrics.echo', { text: 'x'.repeat(1000) });
        expect(result.text).toHaveLength(1000);

        expect(metricsA.rpcOutgoing.get(['metrics.echo', 'ok'])).toBe(1);
        expect(metricsA.rpcOutgoingDuration.count(['metrics.echo'])).toBe(1);
        // A only forwarded it: nothing handled there.
        expect(metricsA.rpcCalls.get(['metrics.echo', 'ok'])).toBe(0);
        expect(metricsB.rpcCalls.get(['metrics.echo', 'ok'])).toBe(before.handled + 1);

        // The 1000-character payload travels both ways, so each direction carries more than it.
        const outA = metricsA.transportBytes.get(['out', 'request', 'metrics.echo']);
        const inB = metricsB.transportBytes.get(['in', 'request', 'metrics.echo']) - before.inB;
        expect(outA).toBeGreaterThan(1000);
        // The same frame, counted at both ends.
        expect(inB).toBe(outA);
        expect(metricsA.transportPackets.get(['out', 'request', 'metrics.echo'])).toBe(1);

        const outB = metricsB.transportBytes.get(['out', 'response', 'metrics.echo']) - before.outB;
        expect(outB).toBeGreaterThan(1000);
        expect(metricsA.transportBytes.get(['in', 'response', 'metrics.echo'])).toBe(outB);
    });

    it('counts a handler that throws as an error on both sides', async () => {
        await expect(brokerA.call('metrics.fail', {})).rejects.toThrow(/nope/);
        expect(metricsB.rpcCalls.get(['metrics.fail', 'error'])).toBe(1);
        expect(metricsA.rpcOutgoing.get(['metrics.fail', 'error'])).toBe(1);
    });

    it('counts the broker\'s own timeout as a timeout, not an error', async () => {
        await expect(brokerB.call('metrics.slow', {})).rejects.toThrow(/Timeout/);
        expect(metricsB.rpcCalls.get(['metrics.slow', 'timeout'])).toBe(1);
        expect(metricsB.rpcCalls.get(['metrics.slow', 'error'])).toBe(0);

        // On the caller two timers of the same length race: internalCall's rejects the call, and
        // executeRemote's -- which records the outgoing timeout -- fires a moment after it.
        await expect(brokerA.call('metrics.slow', {})).rejects.toThrow(/Timeout/);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(metricsA.rpcOutgoing.get(['metrics.slow', 'timeout'])).toBe(1);
    });

    it('labels a request for an action this node does not serve as unknown, not by its name', async () => {
        const name = `metrics.not-real-${Date.now()}`;
        await expect(brokerB.handleIncomingRPC({
            id: 'req-unknown', topic: name, data: {}, type: 'REQUEST', senderNodeID: 'metrics-a', timestamp: Date.now(),
        })).rejects.toThrow(/not found/);
        expect(metricsB.rpcCalls.get([UNKNOWN_ACTION, 'error'])).toBe(1);
        expect(metricsB.registry.render()).not.toContain(name);
    });

    it('counts gossip by its own topic', () => {
        // Linking alone exchanges presence; by now both sides have sent and received some.
        const text = metricsB.registry.render();
        expect(text).toMatch(/mesh_transport_bytes_total\{direction="in",kind="event",topic="\$node\.presence"\} \d+/);
        expect(text).toMatch(/mesh_transport_packets_total\{direction="out",kind="event",topic="\$node\.[a-z.]+"\} \d+/);
    });
    it('counts who called whom, and which node each remote call went to', async () => {
        brokerA.registerContract(relay, async (args, ctx) => ctx.call('metrics.echo', { text: args.text }));
        const toB = metricsA.outgoingPeer.get(['metrics.echo', 'metrics-b', 'ok']);

        await brokerA.call('metrics.relay', { text: 'via a' });

        // On A: nothing called relay (root); relay called echo; echo went to B and answered.
        expect(metricsA.callEdges.get(['root', 'metrics.relay'])).toBe(1);
        expect(metricsA.callEdges.get(['metrics.relay', 'metrics.echo'])).toBe(1);
        expect(metricsA.outgoingPeer.get(['metrics.echo', 'metrics-b', 'ok'])).toBe(toB + 1);
        // B made no call of its own.
        expect(metricsB.callEdges.get(['metrics.relay', 'metrics.echo'])).toBe(0);
    });
});

describe('installNodeMetrics', () => {
    it('reports node info, event loop, process and registry gauges, and stops cleanly', () => {
        const metrics = new MeshMetrics(new MetricsRegistry());
        const uninstall = installNodeMetrics({
            nodeID: 'node-x',
            version: 'v0.10.8',
            meshVersion: '4.10.0',
            metrics,
            registry: { getNodes: () => [{ available: true }, { available: true }, { available: false }, {}] },
        });

        const text = metrics.registry.render();
        uninstall();

        expect(text).toContain('mesh_node_info{node_id="node-x",version="v0.10.8",mesh_version="4.10.0"} 1\n');
        expect(text).toMatch(/mesh_event_loop_delay_seconds\{stat="p50"\} [0-9.e-]+\n/);
        expect(text).toMatch(/mesh_event_loop_delay_seconds\{stat="p99"\} [0-9.e-]+\n/);
        expect(text).toMatch(/mesh_event_loop_delay_seconds\{stat="max"\} [0-9.e-]+\n/);
        expect(text).toMatch(/\nmesh_event_loop_utilization [0-9.e-]+\n/);
        expect(text).toMatch(/# TYPE process_cpu_seconds_total counter\nprocess_cpu_seconds_total [0-9.e-]+\n/);
        expect(text).toMatch(/\nprocess_resident_memory_bytes [1-9][0-9]*\n/);
        expect(text).toMatch(/\nnodejs_heap_used_bytes [1-9][0-9]*\n/);
        expect(text).toContain('mesh_registry_nodes{available="true"} 3\n');
        expect(text).toContain('mesh_registry_nodes{available="false"} 1\n');
    });
});

describe('link and ping counters', () => {
    it('counts ping failures by peer, an unidentified socket as one series however many dials', () => {
        const metrics = new MeshMetrics();

        metrics.recordPingFailure('edge1');
        metrics.recordPingFailure('edge1');
        metrics.recordPingFailure('bootstrap_k3j2');
        metrics.recordPingFailure('bootstrap_9fz1');

        expect(metrics.pingFailures.get(['edge1'])).toBe(2);
        expect(metrics.pingFailures.get(['unidentified'])).toBe(2);
        expect(metrics.registry.render()).toContain('mesh_ping_failures_total{peer="edge1"} 2');
    });
});
