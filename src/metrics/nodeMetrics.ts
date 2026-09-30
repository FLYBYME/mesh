import { monitorEventLoopDelay, performance, type EventLoopUtilization } from 'node:perf_hooks';
import { meshMetrics, type MeshMetrics } from './MeshMetrics.js';

/**
 * What only a Node process can report about itself: event loop delay and utilization, CPU, memory
 * -- plus who this node is and what its registry sees. Node-only (perf_hooks, process), so it is
 * exported from `@flybyme/mesh/node` and never from the browser entry.
 *
 * The event loop numbers are the ones that would have named the 2026-09-30 incident without a
 * laptop: a node spending half a core parsing gossip shows as utilization near 0.5 and a p99 delay
 * in the tens of milliseconds, long before any single call looks slow.
 */

/** The part of a registry this needs -- IServiceRegistry satisfies it. */
export interface NodeCountSource {
    getNodes(): ReadonlyArray<{ readonly available?: boolean }>;
}

export interface NodeMetricsOptions {
    readonly nodeID: string;
    /** The release running this node (mesh-serve's version, for a mesh-serve node). */
    readonly version: string;
    /** The mesh framework's own version, when the caller knows it. */
    readonly meshVersion?: string;
    /** For `mesh_registry_nodes` -- omitted, that metric is not reported. */
    readonly registry?: NodeCountSource;
    /** Defaults to the process-wide `meshMetrics`. */
    readonly metrics?: MeshMetrics;
    /** perf_hooks sampling resolution for the event loop delay histogram, ms. Default 10. */
    readonly eventLoopResolutionMs?: number;
}

/**
 * Registers the process and node gauges on `metrics.registry` and starts sampling the event loop.
 * Returns the function that stops sampling and removes the collectors (the gauges themselves stay
 * registered, at their last values, since a registry has no way to unregister a metric).
 *
 * Event loop delay (p50/p99/max) and utilization are **since the previous scrape**: the delay
 * histogram is reset and the utilization baseline moved each time the registry renders. That is
 * what makes a spike between two scrapes visible at all, and the cost is that a second scraper (a
 * `curl` by hand while VictoriaMetrics also scrapes) splits the window between them.
 */
export function installNodeMetrics(options: NodeMetricsOptions): () => void {
    const metrics = options.metrics ?? meshMetrics;
    const registry = metrics.registry;

    const info = registry.gauge(
        'mesh_node_info',
        'Always 1; its labels say which node and release this process is.',
        ['node_id', 'version', 'mesh_version'],
    );
    info.reset();
    info.set([options.nodeID, options.version, options.meshVersion ?? 'unknown'], 1);

    const loopDelay = registry.gauge(
        'mesh_event_loop_delay_seconds',
        'Event loop delay since the previous scrape (perf_hooks.monitorEventLoopDelay, less its sampling interval), by stat: p50, p99, max.',
        ['stat'],
    );
    const loopUtilization = registry.gauge(
        'mesh_event_loop_utilization',
        'Fraction of wall time the event loop was busy since the previous scrape (0-1).',
    );
    const cpu = registry.counter('process_cpu_seconds_total', 'User and system CPU time spent by this process, in seconds.');
    const rss = registry.gauge('process_resident_memory_bytes', 'Resident memory of this process, in bytes.');
    const heapUsed = registry.gauge('nodejs_heap_used_bytes', 'V8 heap in use, in bytes.');
    const registryNodes = options.registry !== undefined
        ? registry.gauge('mesh_registry_nodes', 'Nodes in this node\'s registry, by whether they are currently available.', ['available'])
        : undefined;

    const resolutionMs = options.eventLoopResolutionMs ?? 10;
    const delay = monitorEventLoopDelay({ resolution: resolutionMs });
    delay.enable();
    let lastUtilization: EventLoopUtilization = performance.eventLoopUtilization();

    // perf_hooks records the whole interval between its timer's ticks, resolution included: an idle
    // loop at resolution 10 reports a p50 of ~10.1 ms (measured, Node 22). Subtracted, so an idle
    // node reads ~0 and the number is the delay itself. With no sample yet percentile() and max
    // are 0, which clamps to 0 -- the honest answer.
    const delaySeconds = (ns: number): number => Math.max(0, ns / 1e9 - resolutionMs / 1000);

    const removeCollector = registry.addCollector(() => {
        loopDelay.set(['p50'], delaySeconds(delay.percentile(50)));
        loopDelay.set(['p99'], delaySeconds(delay.percentile(99)));
        loopDelay.set(['max'], delaySeconds(delay.max));
        delay.reset();

        const now = performance.eventLoopUtilization();
        loopUtilization.set([], performance.eventLoopUtilization(now, lastUtilization).utilization);
        lastUtilization = now;

        const usage = process.cpuUsage();
        cpu.setTotal([], (usage.user + usage.system) / 1e6);
        const memory = process.memoryUsage();
        rss.set([], memory.rss);
        heapUsed.set([], memory.heapUsed);

        if (registryNodes !== undefined && options.registry !== undefined) {
            let available = 0;
            let unavailable = 0;
            for (const node of options.registry.getNodes()) {
                // Unset counts as available: registerNode defaults it to true.
                if (node.available === false) unavailable++;
                else available++;
            }
            registryNodes.set(['true'], available);
            registryNodes.set(['false'], unavailable);
        }
    });

    return () => {
        removeCollector();
        delay.disable();
    };
}
