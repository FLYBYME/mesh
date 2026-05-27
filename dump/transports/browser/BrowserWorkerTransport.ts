import type { ITransport } from '../../interfaces/ITransport';
import type { IMeshPacket } from '../../contracts/packet.schema';
import { MeshPacketSchema } from '../../contracts/packet.schema';

/**
 * BrowserWorkerTransport — Strict bridge for Web Worker environments.
 */
export class BrowserWorkerTransport implements ITransport {
    private messageHandler: ((p: IMeshPacket) => void) | null = null;
    private errorHandler: ((e: Error) => void) | null = null;

    constructor(private worker: Worker | any) {
        this.initListeners();
    }

    private initListeners() {
        this.worker.onmessage = (event: MessageEvent<unknown>) => {
            try {
                // Task 4 Upgrade: Strict Parsing (Zod Firewall)
                const packet = MeshPacketSchema.parse(event.data);
                this.messageHandler?.(packet);
            } catch (err) {
                this.errorHandler?.(new Error(`[Worker] Validation Failed: ${err}`));
            }
        };

        this.worker.onmessageerror = (_err: MessageEvent<unknown>) => {
            this.errorHandler?.(new Error(`[Worker] Message Deserialization Error`));
        };
    }

    async connect(): Promise<void> {
        // Workers are usually "connected" immediately upon instantiation
        return Promise.resolve();
    }

    async disconnect(): Promise<void> {
        if (this.worker instanceof Worker) {
            this.worker.terminate();
        }
        return Promise.resolve();
    }

    async send(packet: IMeshPacket): Promise<void> {
        this.worker.postMessage(packet);
    }

    onMessage(handler: (packet: IMeshPacket) => void): void {
        this.messageHandler = handler;
    }

    onError(handler: (error: Error) => void): void {
        this.errorHandler = handler;
    }
}
