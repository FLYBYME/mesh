import { EventEmitter } from 'eventemitter3';
import { BaseSerializer } from '../serializers/BaseSerializer.js';
import type { TransportConnectOptions, TransportType, MeshPacket, PeerLink } from '../interfaces/IMeshNetwork.js';

/**
 * BaseTransport — abstract contract for node-to-node communication.
 */
export abstract class BaseTransport extends EventEmitter {
    abstract readonly protocol: TransportType;
    abstract readonly version: number;

    protected serializer: BaseSerializer;
    protected connected = false;
    protected nodeID: string = 'unknown';
    protected subscriptions = new Map<string, ((data: unknown) => void)[]>();

    constructor(serializer: BaseSerializer) {
        super();
        this.serializer = serializer;
    }

    /** Establish the connection */
    abstract connect(opts: TransportConnectOptions): Promise<void>;

    /** Post-connection initialization (optional) */
    async start(): Promise<void> {
        // Default implementation does nothing
    }

    /** Gracefully close the connection */
    abstract disconnect(): Promise<void>;

    /** Send a packet to a specific node */
    abstract send(nodeID: string, packet: MeshPacket): Promise<void>;

    /**
     * Whether this transport currently holds a direct connection to `nodeID`.
     *
     * Needed so a node can dial peers it has only heard about second-hand
     * without redialing ones it is already attached to. Defaults to false, so a
     * transport that does not track connections simply never claims one.
     */
    isPeerConnected(_nodeID: string): boolean {
        return false;
    }

    /** Every direct link this transport holds. A transport that does not track links reports none. */
    peerLinks(): readonly PeerLink[] {
        return [];
    }

    /**
     * Whether `url` needs dialing: false when this transport already holds a link to whatever node
     * is there (in either direction), is dialing it, has a redial scheduled, or knows it is this
     * node. `undefined` means the transport does not track links per URL -- and so cannot promise
     * that a repeated `connectToPeer` is harmless -- which is the default.
     */
    needsDial(_url: string): boolean | undefined {
        return undefined;
    }

    /** Establish a direct peer connection (optional implementation) */
    async connectToPeer(_nodeID: string, _url: string, _options?: Record<string, unknown>): Promise<void> {
        throw new Error(`Transport ${this.protocol} does not support direct peer connections`);
    }

    /** Subscribe to a topic / channel */
    async subscribe(topic: string): Promise<void> {
        if (!this.subscriptions.has(topic)) {
            this.subscriptions.set(topic, []);
        }
    }

    /** Add a handler callback for a topic */
    addHandler(topic: string, handler: (data: unknown) => void): void {
        const handlers = this.subscriptions.get(topic) ?? [];
        handlers.push(handler);
        this.subscriptions.set(topic, handlers);
    }

    /** Publish a message to a topic */
    abstract publish(topic: string, packet: MeshPacket): Promise<void>;

    isConnected(): boolean {
        return this.connected;
    }

    /** Returns the actual bound port (if applicable) */
    getPort(): number {
        return 0;
    }
}
