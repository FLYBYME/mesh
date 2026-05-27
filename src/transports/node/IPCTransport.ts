import { BaseTransport } from '../BaseTransport.js';
import { BaseSerializer } from '../../serializers/BaseSerializer.js';
import type { TransportConnectOptions, MeshPacket } from '../../interfaces/IMeshNetwork.js';
import { Worker, MessagePort } from 'node:worker_threads';

/**
 * IPCTransport — Node.js implementation using 'node:worker_threads'.
 */
export class IPCTransport extends BaseTransport {
    readonly protocol = 'ipc';
    readonly version = 1;
    private workers = new Map<string, Worker>();
    private isWorker = false;

    constructor(serializer: BaseSerializer) {
        super(serializer);
        const { isMainThread } = eval('require')('node:worker_threads');
        this.isWorker = !isMainThread;
    }

    async connect(_opts: TransportConnectOptions): Promise<void> {
        const { parentPort } = eval('require')('node:worker_threads');
        if (this.isWorker && parentPort) {
            parentPort.on('message', (raw: unknown) => this.handleIncoming(raw as { topic: string, data: unknown }));
        }
        this.connected = true;
        this.emit('connected');
    }

    async disconnect(): Promise<void> {
        this.workers.clear();
        const { parentPort } = eval('require')('node:worker_threads');
        if (this.isWorker && parentPort) {
            parentPort.removeAllListeners('message');
        }
        this.connected = false;
        this.emit('disconnected');
    }

    registerWorker(nodeID: string, worker: Worker): void {
        this.workers.set(nodeID, worker);
        worker.on('message', (raw: unknown) => {
            if (raw && typeof raw === 'object' && 'topic' in raw) {
                this.handleIncoming(raw as { topic: string, data: unknown });
            }
        });
    }

    async send(nodeID: string, packet: MeshPacket): Promise<void> {
        const envelope = { topic: '__direct', data: packet, senderNodeID: this.nodeID };
        const target = this.workers.get(nodeID);
        if (target) {
            target.postMessage(envelope);
            return;
        }

        const { parentPort } = eval('require')('node:worker_threads');
        if (this.isWorker && parentPort) {
            parentPort.postMessage(envelope);
        }
    }

    async publish(topic: string, packet: MeshPacket): Promise<void> {
        // Phase 3: Block REQUEST broadcasts
        if (packet.type === 'REQUEST') {
            return;
        }

        const { parentPort } = eval('require')('node:worker_threads') as { parentPort: MessagePort | null };
        if (this.isWorker && parentPort) {
            parentPort.postMessage(packet);
        } else {
            for (const worker of this.workers.values()) {
                worker.postMessage(packet);
            }
        }
        const handlers = this.subscriptions.get(topic) || [];
        for (const handler of handlers) handler(packet.data ?? packet);
    }

    private handleIncoming(raw: { topic: string, data: unknown }): void {
        const { topic, data } = raw;
        const handlers = this.subscriptions.get(topic) || [];
        for (const handler of handlers) handler(data);
        this.emit('packet', raw as MeshPacket);
    }
}
