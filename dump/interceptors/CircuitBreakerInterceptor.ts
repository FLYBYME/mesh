import type { IInterceptor } from '../interfaces';
import type { MeshPacket } from '../types/packet.types';

type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface BreakerInfo {
    state: BreakerState;
    failures: number;
    lastFailureTime: number;
}

interface IMetrics {
    increment(name: string, value: number, labels?: Record<string, string>): void;
}

/**
 * CircuitBreakerInterceptor — Prevents cascading failures by tripping the circuit for failing nodes.
 * Ties into metrics if a metrics registry is provided.
 */
export class CircuitBreakerInterceptor implements IInterceptor<MeshPacket, MeshPacket> {
    public readonly name = 'circuit-breaker';
    
    private breakers = new Map<string, BreakerInfo>();
    private readonly FAILURE_THRESHOLD = 5;
    private readonly RESET_TIMEOUT = 30000; // 30 seconds
    private readonly MAX_BREAKERS = 2000;

    constructor(private metrics?: IMetrics) {}

    async onOutbound(packet: MeshPacket): Promise<MeshPacket> {
        const targetNodeID = packet.targetNodeID || (packet.meta?.targetNodeID as string);
        if (!targetNodeID || targetNodeID === '*') return packet;

        const info = this.getBreaker(targetNodeID);

        if (info.state === 'OPEN') {
            const now = Date.now();
            if (now - info.lastFailureTime > this.RESET_TIMEOUT) {
                info.state = 'HALF_OPEN';
            } else {
                // Trip metrics
                if (this.metrics) {
                    this.metrics.increment('mesh.circuit_breaker.rejected', 1, { targetNodeID });
                }
                
                // Drop packet by returning a special topic
                return { ...packet, topic: '__circuit_open', data: undefined };
            }
        }

        return packet;
    }

    async onInbound(packet: MeshPacket): Promise<MeshPacket> {
        if (packet.type === 'RESPONSE_ERROR') {
            this.recordFailure(packet.senderNodeID);
        } else if (packet.type === 'RESPONSE') {
            this.recordSuccess(packet.senderNodeID);
        }
        return packet;
    }

    /**
     * Call this when a response error occurs for a specific node.
     */
    public recordFailure(nodeID: string): void {
        const info = this.getBreaker(nodeID);
        info.failures++;
        info.lastFailureTime = Date.now();

        if (info.failures >= this.FAILURE_THRESHOLD) {
            if (info.state !== 'OPEN') {
                info.state = 'OPEN';
                if (this.metrics) {
                    this.metrics.increment('mesh.circuit_breaker.tripped', 1, { nodeID });
                }
            }
        }
    }

    /**
     * Call this when a successful response is received from a node.
     */
    public recordSuccess(nodeID: string): void {
        const info = this.getBreaker(nodeID);
        info.failures = 0;
        info.state = 'CLOSED';
    }

    private getBreaker(nodeID: string): BreakerInfo {
        let info = this.breakers.get(nodeID);
        if (!info) {
            if (this.breakers.size >= this.MAX_BREAKERS) {
                // Clear all to prevent OOM. In production, use LRU.
                this.breakers.clear();
            }
            info = { state: 'CLOSED', failures: 0, lastFailureTime: 0 };
            this.breakers.set(nodeID, info);
        }
        return info;
    }
}
