import { BaseBalancer } from './BaseBalancer.js';
import type { NodeInfo } from '../types/registry.schema.js';

/**
 * RoundRobinBalancer — cycles through nodes in sequential order.
 */
export class RoundRobinBalancer extends BaseBalancer {
    private counters = new Map<string, number>();
    private readonly MAX_COUNTERS = 1000;

    select(nodes: NodeInfo[], ctx?: Record<string, unknown>): NodeInfo | null {
        if (nodes.length === 0) return null;
        if (nodes.length === 1) return nodes[0];

        const key = ctx?.toolName as string || 'default';
        
        // Memory Leak Protection: prevent unbounded growth of counters Map
        if (this.counters.size > this.MAX_COUNTERS && !this.counters.has(key)) {
            this.counters.clear();
        }

        const counter = (this.counters.get(key) ?? 0) % nodes.length;
        this.counters.set(key, counter + 1);

        return nodes[counter];
    }
}
