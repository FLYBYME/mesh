import { BaseTransport } from './BaseTransport';
import { BaseSerializer } from '../serializers/BaseSerializer';
import type { TransportConnectOptions } from '../types/mesh.types';
import type { MeshPacket } from '../types/packet.types';
import { Env } from '../utils/Env';

export interface INatsMessage {
    data: Uint8Array;
}

export interface INatsSubscription {
    unsubscribe(): void;
    [Symbol.asyncIterator](): AsyncIterator<INatsMessage>;
}

export interface INatsConnection {
    closed(): Promise<Error | void>;
    drain(): Promise<void>;
    subscribe(topic: string): INatsSubscription;
    publish(topic: string, data: Uint8Array): void;
}

export class NATSTransport extends BaseTransport {
    readonly protocol = 'nats';
    public readonly version = 1;
    private client: INatsConnection | null = null;
    private subs: INatsSubscription[] = [];
    private isDisconnecting = false;

    constructor(serializer: BaseSerializer) {
        super(serializer);
    }

    async connect(opts: TransportConnectOptions): Promise<void> {
        if (Env.isBrowser()) {
            throw new Error('[NATSTransport] NATS is not supported in the browser.');
        }
        
        this.isDisconnecting = false;
        const { connect } = await import('nats');
        this.client = await connect({ servers: opts.url }) as unknown as INatsConnection;
        this.connected = true;
        this.emit('connected');

        (async () => {
            if (!this.client) return;
            const err = await this.client.closed();
            if (!this.isDisconnecting) {
                this.connected = false;
                this.emit('disconnected');
                if (err) this.emit('error', err);
            }
        })();
    }

    async disconnect(): Promise<void> {
        this.isDisconnecting = true;
        for (const sub of this.subs) sub.unsubscribe();
        this.subs = [];
        if (this.client) {
            await this.client.drain();
            this.client = null;
        }
        this.connected = false;
        this.emit('disconnected');
    }

    async send(nodeID: string, packet: MeshPacket): Promise<void> {
        await this.publish(`mesh.${nodeID}`, packet);
    }

    async subscribe(topic: string): Promise<void> {
        if (!this.client) return;
        const sub = this.client.subscribe(topic);
        this.subs.push(sub);

        (async () => {
            try {
                for await (const msg of sub) {
                    if (this.isDisconnecting) break;
                    try {
                        const data = this.serializer.deserialize(msg.data) as MeshPacket;
                        const handlers = this.subscriptions.get(topic) ?? [];
                        for (const handler of handlers) handler(data);
                        this.emit('packet', data);
                    } catch (err) {
                        this.emit('error', err instanceof Error ? err : new Error(String(err)));
                    }
                }
            } catch {
                // Iterator might be closed
            }
        })();
    }

    async publish(topic: string, packet: MeshPacket): Promise<void> {
        if (!this.client) return;
        const buf = this.serializer.serialize(packet);
        this.client.publish(topic, buf);
    }
}
