import { BaseBalancer } from './BaseBalancer';
import type { NodeInfo } from '../types/registry.schema';

/**
 * HealthAwareBalancer — Leverages the normalized healthScore (CPU + Active Requests)
 * calculated by the ServiceRegistry to make routing decisions.
 */
export class HealthAwareBalancer extends BaseBalancer {
    select(nodes: NodeInfo[], _ctx?: Record<string, unknown>): NodeInfo | null {
        if (nodes.length === 0) return null;
        if (nodes.length === 1) return nodes[0];

        // Sort by healthScore descending
        const sorted = [...nodes].sort((a, b) => (b.healthScore ?? 0) - (a.healthScore ?? 0));

        // Pick from the top 3 healthiest nodes randomly to avoid overloading a single "best" node
        const candidates = sorted.slice(0, Math.min(3, sorted.length));
        return candidates[Math.floor(Math.random() * candidates.length)];
    }
}
