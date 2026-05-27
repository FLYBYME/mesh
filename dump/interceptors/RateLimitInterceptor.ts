import type { IInterceptor, TimerHandle } from '../interfaces';
import { SafeTimer } from '../interfaces';
import type { MeshPacket } from '../types/packet.types';

interface RateLimitInfo {
    count: number;
    resetAt: number;
}

interface IMetrics {
    increment(name: string, value: number, labels?: Record<string, string>): void;
}

/**
 * RateLimitInterceptor — Enforces sliding window rate limits on inbound packets.
 * Ties into metrics if a metrics registry is provided.
 */
export class RateLimitInterceptor implements IInterceptor<MeshPacket, MeshPacket> {
    public readonly name = 'rate-limit';
    
    private rateLimits = new Map<string, RateLimitInfo>();
    private readonly MAX_PACKETS_PER_WINDOW = 1000;
    private readonly WINDOW_MS = 60000;
    private cleanupInterval?: TimerHandle;

    constructor(private metrics?: IMetrics) {
        this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000); // 5 mins
        SafeTimer.unref(this.cleanupInterval);
    }

    async onInbound(packet: MeshPacket): Promise<MeshPacket> {
        if (!packet.senderNodeID) return packet;
 
        const meta = packet.meta as { tenant_id?: string } | undefined;
        const tenantID = meta?.tenant_id || 'default';
        const key = `${tenantID}:${packet.senderNodeID}`;

        if (!this.checkRateLimit(key)) {
            // Emit metrics event if registry is tied
            if (this.metrics) {
                this.metrics.increment('mesh.rate_limit.exceeded', 1, { 
                    senderNodeID: packet.senderNodeID,
                    tenantID
                });
            }

            // Drop packet by returning a special topic
            return { ...packet, topic: '__dropped', data: undefined };
        }

        return packet;
    }

    private checkRateLimit(key: string): boolean {
        const now = Date.now();
        let info = this.rateLimits.get(key);

        if (!info || now > info.resetAt) {
            info = { count: 1, resetAt: now + this.WINDOW_MS };
            this.rateLimits.set(key, info);
            return true;
        }

        info.count++;
        if (info.count > this.MAX_PACKETS_PER_WINDOW) {
            return false;
        }

        return true;
    }

    /**
     * Periodically cleanup the rate limit cache.
     */
    public cleanup(): void {
        const now = Date.now();
        for (const [key, info] of this.rateLimits.entries()) {
            if (now > info.resetAt) {
                this.rateLimits.delete(key);
            }
        }
    }

    public stop(): void {
        if (this.cleanupInterval) {
            SafeTimer.clearInterval(this.cleanupInterval);
            this.cleanupInterval = undefined;
        }
    }
}
