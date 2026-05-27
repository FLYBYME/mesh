import type { ILogger, IServiceRegistry } from '../types/mesh.types';
import type { MeshPacket } from '../types/packet.types';

export type NetworkHandler = (data: unknown, packet: MeshPacket) => void | Promise<void>;

/**
 * NetworkDispatcher - Routes incoming network packets to the appropriate handlers.
 * Includes Hub-and-Spoke Proxy logic.
 */
export class NetworkDispatcher {
    private handlers: Map<string, NetworkHandler[]> = new Map();
    private prefixHandlers: Map<string, NetworkHandler[]> = new Map();

    constructor(
        private logger: ILogger,
        private registry?: IServiceRegistry,
        private nodeID?: string,
        private transportSend?: (nodeID: string, packet: MeshPacket) => Promise<void>
    ) { }

    /**
     * Register a handler for a specific topic or a topic prefix (using *).
     */
    on(topic: string, handler: NetworkHandler): void {
        this.logger.debug(`[NetworkDispatcher] Registering handler for topic: ${topic}`);
        if (topic === '*') {
            const list = this.prefixHandlers.get('') || [];
            list.push(handler);
            this.prefixHandlers.set('', list);
        } else if (topic.endsWith('*')) {
            const prefix = topic.slice(0, -1);
            const list = this.prefixHandlers.get(prefix) || [];
            list.push(handler);
            this.prefixHandlers.set(prefix, list);
        } else {
            const list = this.handlers.get(topic) || [];
            list.push(handler);
            this.handlers.set(topic, list);
        }
    }

    /**
     * Dispatch an incoming packet to the registered handlers.
     */
    async dispatch(packet: MeshPacket): Promise<void> {
        const isDirect = packet.topic === '__direct';
        let topic = packet.topic;
        let data: unknown = packet;

        if (isDirect) {
            const directData = packet.data as { topic?: string, data?: unknown } | undefined;
            if (directData?.topic) {
                topic = directData.topic;
                data = directData.data;
            }
        } else if ('data' in packet) {
            data = packet.data;
        }

        if (!topic) {
            this.logger.warn('[NetworkDispatcher] Received packet without topic', { packet });
            return;
        }

        // 1. Exact Match
        const exactHandlers = this.handlers.get(topic) || [];
        for (const handler of exactHandlers) {
            await handler(data, packet);
        }

        // 2. Prefix Match (Including global '*')
        let handled = exactHandlers.length > 0;
        for (const [prefix, hList] of this.prefixHandlers.entries()) {
            if (prefix === '' || topic.startsWith(prefix)) {
                handled = true;
                for (const h of hList) {
                    await h(data, packet);
                }
            }
        }

        if (!handled) {
            this.logger.debug(`[NetworkDispatcher] No handler registered for topic: ${topic}`, { internal: true });
        }
    }

    public stop(): void {
        this.handlers.clear();
        this.prefixHandlers.clear();
    }

    public hasHandler(topic: string): boolean {
        if (this.handlers.has(topic)) return true;
        for (const prefix of this.prefixHandlers.keys()) {
            if (topic.startsWith(prefix)) return true;
        }
        return false;
    }
}
