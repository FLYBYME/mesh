import { BaseBalancer } from './BaseBalancer';
import type { NodeInfo } from '../types/registry.schema';

/**
 * CpuUsageBalancer — selects nodes with the lowest reported CPU usage.
 */
export class CpuUsageBalancer extends BaseBalancer {
    select(nodes: NodeInfo[], _ctx?: Record<string, unknown>): NodeInfo | null {
        if (nodes.length === 0) return null;

        let bestNode = nodes[0];
        let minCpu = bestNode.cpu ?? 100;

        for (let i = 1; i < nodes.length; i++) {
            const cpu = nodes[i].cpu ?? 100;
            if (cpu < minCpu) {
                minCpu = cpu;
                bestNode = nodes[i];
            }
        }

        return bestNode;
    }
}
