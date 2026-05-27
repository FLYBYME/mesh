import { BaseBalancer } from './BaseBalancer';
import type { NodeInfo } from '../types/registry.schema';
import type { IMeshAuthMeta  } from '../types/registry.types';

/**
 * ShardBalancer — Deterministically routes a request to the same node
 * based on a shardKey (e.g., tenantId, userId) to maximize cache hits.
 * Uses consistent hashing to ensure stability when nodes join or leave.
 */
export class ShardBalancer extends BaseBalancer {
    private readonly VIRTUAL_NODES = 40;

    /**
     * FNV-1a (32-bit) Hash Implementation
     */
    private hash(str: string): number {
        let hash = 2166136261;
        for (let i = 0; i < str.length; i++) {
            hash ^= str.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    }

    /**
     * Select a node using consistent hashing.
     */
    select(nodes: NodeInfo[], ctx?: Record<string, unknown>): NodeInfo | null {
        if (nodes.length === 0) return null;
        if (nodes.length === 1) return nodes[0];

        const meta = ctx as IMeshAuthMeta | undefined;
        const shardKey = meta?.shardKey;

        if (!shardKey) {
            return nodes[0];
        }

        // Build a consistent hash ring for the current nodes
        const ring: { hash: number, node: NodeInfo }[] = [];
        for (const node of nodes) {
            for (let i = 0; i < this.VIRTUAL_NODES; i++) {
                ring.push({
                    hash: this.hash(`${node.nodeID}:${i}`),
                    node
                });
            }
        }

        // Sort ring by hash
        ring.sort((a, b) => a.hash - b.hash);

        const keyHash = this.hash(shardKey);

        // Find the first node with a hash >= keyHash
        for (const entry of ring) {
            if (entry.hash >= keyHash) {
                return entry.node;
            }
        }

        // Wrap around to the first node
        return ring[0].node;
    }
}
