import express from 'express';
import type { Express, Request, Response } from 'express';
import { Server } from 'node:http';
import { BaseTransport } from '../BaseTransport';
import { BaseSerializer } from '../../serializers/BaseSerializer';
import type { TransportConnectOptions } from '../../types/mesh.types';
import type { MeshPacket } from '../../types/packet.types';

/**
 * HTTPTransport — Node.js implementation using 'express' and 'http'.
 */
export class HTTPTransport extends BaseTransport {
    readonly protocol = 'http';
    readonly version = 1;
    private app: Express | null = null;
    private server: Server | null = null;
    private peerAddresses = new Map<string, string>();

    constructor(serializer: BaseSerializer) {
        super(serializer);
    }

    async connect(opts: TransportConnectOptions): Promise<void> {
        this.app = express();

        const app = this.app!;
        app.use(express.raw({ type: '*/*', limit: '10mb' }));

        app.post('/rpc/:topic', (req: Request, res: Response) => {
            const topic = req.params.topic;
            const data = this.serializer.deserialize(req.body) as MeshPacket;
            const handlers = this.subscriptions.get(topic) || [];
            for (const handler of handlers) handler(data);
            this.emit('packet', data);
            res.status(200).send('OK');
        });

        return new Promise((resolve, reject) => {
            this.server = app.listen(opts.port || 0, () => {
                this.connected = true;
                this.emit('connected');
                resolve();
            });
            this.server.on('error', reject);
        });
    }

    async disconnect(): Promise<void> {
        if (this.server) {
            const server = this.server;
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
        this.connected = false;
        this.emit('disconnected');
    }

    async send(nodeID: string, packet: MeshPacket): Promise<void> {
        const address = this.peerAddresses.get(nodeID);
        if (!address) throw new Error(`No address for node ${nodeID}`);

        const buf = this.serializer.serialize(packet);
        const response = await fetch(`${address}/rpc/__direct`, {
            method: 'POST',
            body: buf as BodyInit,
            headers: { 'Content-Type': 'application/octet-stream' },
        });
        if (!response.ok) throw new Error(`HTTP send failed: ${response.status}`);
    }

    async publish(_topic: string, _packet: MeshPacket): Promise<void> {
        // SSE not implemented
    }

    async connectToPeer(nodeID: string, address: string): Promise<void> {
        this.peerAddresses.set(nodeID, address);
    }
}
