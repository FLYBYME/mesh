import type { NodeInfo } from '../types/registry.schema.js';

/**
 * BaseBalancer — abstract contract for node selection.
 */
export abstract class BaseBalancer {
    abstract select(nodes: NodeInfo[], ctx?: Record<string, unknown>): NodeInfo | null;
}
