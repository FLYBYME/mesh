import { BaseBalancer } from './BaseBalancer';
import type { NodeInfo } from '../types/registry.schema';

/**
 * LatencyBalancer — selects nodes with the lowest recorded latency.
 */
export class LatencyBalancer extends BaseBalancer {
    public latencies = new Map<string, number>();

    /**
     * Update the latency for a specific node.
     * Usually called by the networking layer after a ping/pong.
     */
    public recordLatency(nodeID: string, ms: number): void {
        const current = this.latencies.get(nodeID) ?? ms;
        // Moving average (alpha = 0.2) to smooth out spikes
        this.latencies.set(nodeID, (current * 0.8) + (ms * 0.2));
    }

    select(nodes: NodeInfo[], _ctx?: Record<string, unknown>): NodeInfo | null {
        if (nodes.length === 0) return null;
        if (nodes.length === 1) return nodes[0];

        let bestNode = nodes[0];
        let minLatency = this.latencies.get(bestNode.nodeID) ?? 9999;

        for (let i = 1; i < nodes.length; i++) {
            const lat = this.latencies.get(nodes[i].nodeID) ?? 9999;
            if (lat < minLatency) {
                minLatency = lat;
                bestNode = nodes[i];
            }
        }

        return bestNode;
    }
}
