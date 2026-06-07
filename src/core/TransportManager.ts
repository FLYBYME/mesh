import { EventEmitter } from 'eventemitter3';
import { BaseTransport } from '../transports/BaseTransport.js';
import type { IMeshNetworkNode, TransportType, TransportConnectOptions, MeshPacket } from '../interfaces/IMeshNetwork.js';

export interface TransportManagerOptions {
    transports: BaseTransport[];
}

/**
 * TransportManager
 * Manages a collection of injected transports.
 * Decoupled from specific implementations to prevent dependency leakage.
 */
export class TransportManager extends EventEmitter {
    private transports = new Map<TransportType, BaseTransport>();
    private primaryTransport: BaseTransport;

    constructor(options: TransportManagerOptions, private node: IMeshNetworkNode) {
        super();

        if (options.transports.length === 0) {
            throw new Error('[TransportManager] At least one transport must be provided.');
        }
        for (const transport of options.transports) {
            transport.on('packet', (envelope: MeshPacket) => this.emit('packet', envelope));
            transport.on('peer:connect', (peerNodeID: string) => {
                this.node.logger.debug(`Peer connected: ${peerNodeID}`, { 
                    peerNodeID,
                    internal: true 
                });
                if (this.node.orchestrator) {
                    this.node.orchestrator.handlePeerConnect(peerNodeID);
                }
            });
            transport.on('peer:disconnect', (peerNodeID: string) => {
                this.node.logger.info(`Peer disconnected: ${peerNodeID}`, { 
                    peerNodeID,
                    internal: true 
                });
                if (this.node.orchestrator) {
                    this.node.orchestrator.handlePeerDisconnect(peerNodeID);
                }
            });
            this.transports.set(transport.protocol, transport);
        }

        // Use the first provided transport as primary
        this.primaryTransport = options.transports[0];
    }

    async connect(opts: Partial<TransportConnectOptions>): Promise<void> {
        for (const t of this.transports.values()) {
            await t.connect({
                url: opts.url || '',
                nodeID: this.node.nodeID,
                namespace: this.node.namespace,
                logger: this.node.logger,
                port: opts.port,
                registry: opts.registry || this.node.registry,
                sharedServer: opts.sharedServer,
                sharedApp: opts.sharedApp,
                host: opts.host,
                authToken: opts.authToken,
                privateKey: opts.privateKey
            });

            await t.start();
        }
    }

    async disconnect(): Promise<void> {
        for (const t of this.transports.values()) {
            await t.disconnect();
        }
    }

    getTransport(): BaseTransport {
        return this.primaryTransport;
    }

    getTransportByType<T extends BaseTransport>(type: TransportType): T | undefined {
        return this.transports.get(type) as T;
    }

    async send(nodeID: string, packet: MeshPacket): Promise<void> {
        const transport = this.selectBestRoute(nodeID);
        return transport.send(nodeID, packet);
    }

    private selectBestRoute(nodeID: string): BaseTransport {
        const node = this.node.registry.getNode(nodeID);
        if (!node || !node.addresses) return this.primaryTransport;

        for (const addr of node.addresses) {
            const type = this.getAddressType(addr);
            const t = this.transports.get(type);
            if (t) return t;
        }
        return this.primaryTransport;
    }

    private getAddressType(address: string): TransportType {
        if (address.startsWith('tcp://')) return 'tcp';
        if (address.startsWith('ws://') || address.startsWith('wss://')) return 'ws';
        if (address.startsWith('nats://')) return 'nats';
        if (address.startsWith('http://') || address.startsWith('https://')) return 'http';
        return 'ws';
    }

    async publish(topic: string, packet: MeshPacket): Promise<void> {
        await this.primaryTransport.publish(topic, packet);
    }

    isConnected(): boolean {
        return Array.from(this.transports.values()).some(t => t.isConnected());
    }
}
