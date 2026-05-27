import type { ILogger } from '../types/mesh.types';
import { SafeTimer } from '../interfaces';
import type { TimerHandle } from '../interfaces';

export interface DHTDiscoveryOptions {
    nodeID: string;
    namespace: string;
    bootstrapNodes?: string[];
    logger: ILogger;
    publisher: (topic: string, data: Record<string, unknown>) => Promise<void>;
}

/**
 * DHTDiscovery — Handles node announcement and discovery via the mesh.
 */
export class DHTDiscovery {
    private announceTimer?: TimerHandle;

    constructor(private opts: DHTDiscoveryOptions) { }

    public async start(publicUrl: string): Promise<void> {
        this.opts.logger.info(`Starting DHT discovery for ${this.opts.namespace}`);
        await this.announce(publicUrl);
        this.announceTimer = setInterval(() => this.announce(publicUrl), 300000); // 5 mins
        SafeTimer.unref(this.announceTimer);
    }

    public async stop(): Promise<void> {
        if (this.announceTimer) {
            SafeTimer.clearInterval(this.announceTimer);
            this.announceTimer = undefined;
        }
    }

    /**
     * FIX: Actually broadcast node info to bootstrap nodes or mesh.
     */
    private async announce(address: string): Promise<void> {
        this.opts.logger.debug(`Announcing ${this.opts.nodeID} at ${address}`);
        
        await this.opts.publisher('$node.info', {
            nodeID: this.opts.nodeID,
            namespace: this.opts.namespace,
            addresses: [address],
            type: 'node',
            timestamp: Date.now(),
            available: true
        }).catch(err => {
            this.opts.logger.warn('Failed to publish node announcement', { error: err.message });
        });
    }

    public async discover(): Promise<string[]> {
        // In a full DHT, this would query neighbors
        return [];
    }
}
