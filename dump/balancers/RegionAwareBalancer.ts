import { BaseBalancer } from './BaseBalancer';
import type { NodeInfo } from '../types/registry.schema';

/**
 * RegionAwareBalancer — Wraps another balancer but filters nodes by region first.
 * If no nodes in the same region are available, it falls back to cross-region nodes.
 */
export class RegionAwareBalancer extends BaseBalancer {
    constructor(
        private inner: BaseBalancer,
        private localRegion?: string
    ) {
        super();
    }

    select(nodes: NodeInfo[], ctx?: Record<string, unknown>): NodeInfo | null {
        if (!this.localRegion) return this.inner.select(nodes, ctx);

        const localNodes = nodes.filter(n => n.region === this.localRegion);
        
        if (localNodes.length > 0) {
            return this.inner.select(localNodes, ctx);
        }

        // Fallback to all nodes (cross-region)
        return this.inner.select(nodes, ctx);
    }
}
