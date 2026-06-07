import { EventEmitter } from 'eventemitter3';
import { IMeshNetwork, IMeshPacket, IMeshNetworkSubscriptionHandler, MeshPacket, IMeshNetworkNode } from '../interfaces/IMeshNetwork.js';
import type { ILogger } from '../interfaces/ILogger.js';
import type { IServiceRegistry } from '../interfaces/IServiceRegistry.js';
import { Env } from '../utils/Env.js';
import type { IInterceptor } from '../interfaces/IInterceptor.js';
import { BaseTransport } from '../transports/BaseTransport.js';
import { TransportManager } from './TransportManager.js';
import { NetworkDispatcher } from './NetworkDispatcher.js';
import { NetworkController } from './NetworkController.js';
import { MeshOrchestrator } from './MeshOrchestrator.js';
import { UnifiedServer } from './UnifiedServer.js';
import { SafeTimer } from '../utils/SafeTimer.js';
import { AuthInterceptor } from '../interceptors/AuthInterceptor.js';

export interface MeshNetworkOptions {
    nodeId?: string;
    namespace?: string;
    bootstrapNodes?: string[];
    transports: BaseTransport[];
    port?: number;
    privateKey?: string;
}

/**
 * MeshNetwork: Comprehensive high-level entry point for the networking stack.
 */
export class MeshNetwork extends EventEmitter implements IMeshNetwork, IMeshNetworkNode {
    public readonly nodeID: string;
    public readonly namespace: string;
    public readonly logger: ILogger;
    public readonly registry: IServiceRegistry;

    public readonly transport: TransportManager;
    public readonly dispatcher: NetworkDispatcher;
    public readonly controller: NetworkController;
    public readonly orchestrator: MeshOrchestrator;
    public readonly server: UnifiedServer | null = null;

    private interceptors: IInterceptor<MeshPacket, MeshPacket>[] = [];
    private options: MeshNetworkOptions;

    // Packet Deduplication Cache (Phase 1)
    private seenPackets = new Map<string, number>();
    private readonly PACKET_TTL_MS = 10000;
    private cleanupTimer: NodeJS.Timeout;

    constructor(options: MeshNetworkOptions, logger: ILogger, registry: IServiceRegistry) {
        super();
        this.options = options;
        this.nodeID = options.nodeId || `node_${Math.random().toString(36).substr(2, 9)}`;
        this.namespace = options.namespace || 'default';
        this.logger = logger;
        this.registry = registry;

        if (Env.isNode() && options.port !== undefined) {
            this.server = new UnifiedServer(options.port);
        }

        this.orchestrator = new MeshOrchestrator(this, {
            bootstrapNodes: options.bootstrapNodes
        });

        this.transport = new TransportManager({ transports: options.transports }, this);
        this.dispatcher = new NetworkDispatcher(
            this.logger,
            this.registry,
            this.nodeID,
            (nodeID: string, packet: MeshPacket) => this.transport.send(nodeID, packet)
        );
        this.controller = new NetworkController(this, this.logger);

        this.controller.registerHandlers(this.dispatcher);

        // Automatically register AuthInterceptor if privateKey is provided
        if (options.privateKey) {
            this.use(new AuthInterceptor(this.logger));
        }

        // Start deduplication cleanup loop
        this.cleanupTimer = setInterval(() => {
            const now = Date.now();
            for (const [id, expiry] of this.seenPackets.entries()) {
                if (now > expiry) {
                    this.seenPackets.delete(id);
                }
            }
        }, 5000);

        SafeTimer.unref(this.cleanupTimer);

        this.transport.on('packet', async (packet: MeshPacket) => {
            // Deduplication Check (Phase 1)
            const now = Date.now();

            // Phase 3: Skip deduplication for response packets to allow ID reuse between request/response
            const isResponse = packet.type === 'RESPONSE' || packet.type === 'RESPONSE_ERROR';
            const isFromSelf = packet.senderNodeID === this.nodeID;

            // 1. Loopback Suppression: Drop ALL packets from self that came through the transport.
            // ServiceBroker already handles local delivery immediately.
            if (isFromSelf) {
                return;
            }

            // 2. Namespace Isolation: Drop packets from different namespaces.
            if (packet.namespace && packet.namespace !== this.namespace) {
                return;
            }

            // 3. Deduplication
            if (!isResponse && this.seenPackets.has(packet.id)) {
                return;
            }

            if (!isResponse) {
                this.seenPackets.set(packet.id, now + this.PACKET_TTL_MS);
            }

            this.logger.debug(`[MeshNetwork ${this.nodeID}] Accepted packet: ${packet.topic} from ${packet.senderNodeID} (Target: ${packet.targetNodeID})`);

            // Refresh node lease in registry on every packet
            if (packet.senderNodeID) {
                this.registry.heartbeat(packet.senderNodeID);
            }

            let processedData: MeshPacket = packet;

            for (const interceptor of [...this.interceptors].reverse()) {
                if (interceptor.onInbound) {
                    processedData = await interceptor.onInbound(processedData);
                }
            }

            if (processedData.topic === '__auth_failed') {
                return;
            }

            // 3. Dispatch to generic handlers (Broker bridge)
            for (const handler of this.anyPacketHandlers) {
                try {
                    handler(processedData.data, processedData);
                } catch (err) {
                    this.logger.error('[MeshNetwork] Error in generic packet handler', { error: err });
                }
            }

            // 4. Dispatch to specific handlers
            await this.dispatcher.dispatch(processedData);
        });
    }

    public use(interceptor: IInterceptor<MeshPacket, MeshPacket>): void {
        this.interceptors.push(interceptor);
    }

    async start(): Promise<void> {
        this.logger.info(`[MeshNetwork] Starting node ${this.nodeID}...`);

        let port = this.options.port;

        if (this.server) {
            await this.server.listen();
            port = this.server.getPort();

            const localNode = this.registry.getNode(this.nodeID);
            if (localNode) {
                localNode.addresses = [`ws://127.0.0.1:${port}`];
                this.registry.registerNode(localNode);
            }
        }

        // --- FIXED: Pass the bootstrap URL to the transports ---
        // In the browser, the transport needs this to establish the initial connection.
        await this.transport.connect({
            nodeID: this.nodeID,
            namespace: this.namespace,
            logger: this.logger,
            url: this.options.bootstrapNodes?.[0], // Use primary bootstrap node as connection URL
            port: port,
            registry: this.registry,
            privateKey: this.options.privateKey,
            sharedServer: this.server?.getServer() ?? undefined
        });

        await this.orchestrator.start();
    }

    public async connectToPeer(nodeID: string, url: string): Promise<void> {
        return this.transport.getTransport().connectToPeer(nodeID, url);
    }

    async stop(): Promise<void> {
        await this.orchestrator.stop();
        await this.transport.disconnect();

        for (const interceptor of this.interceptors) {
            if (interceptor.stop) {
                await interceptor.stop();
            }
        }

        this.dispatcher.stop();
        if (this.server) {
            await this.server.stop();
        }
    }

    async send<T = unknown>(targetNodeID: string, topic: string, data: T, options?: Partial<IMeshPacket<T>>): Promise<void> {
        if (targetNodeID === '*') {
            if (options?.type === 'REQUEST') {
                throw new Error('[MeshNetwork] Cannot broadcast REQUEST packets. Use a specific targetNodeID or the Service Broker.');
            }
            return this.publish(topic, data);
        }

        try {
            let priority = options?.priority ?? 1;

            if (topic.startsWith('raft.') || topic.startsWith('kademlia.')) {
                priority = 2;
            }

            const primaryTransport = this.transport.getTransport();

            const packet: MeshPacket = {
                topic,
                data: options?.error ? undefined : data,
                error: options?.error as { message: string; code?: number | string; data?: unknown; },
                id: options?.id || `mesh_${Math.random().toString(36).substr(2, 9)}`,
                type: (options?.type as MeshPacket['type']) || 'EVENT',
                senderNodeID: this.nodeID,
                targetNodeID: targetNodeID,
                namespace: this.namespace,
                timestamp: Date.now(),
                version: primaryTransport.version,
                priority,
                meta: {
                    ttl: 5,
                    path: [this.nodeID],
                    ...options?.meta
                }
            } as MeshPacket;

            let processedPacket = packet;
            for (const interceptor of this.interceptors) {
                if (interceptor.onOutbound) {
                    processedPacket = await interceptor.onOutbound(processedPacket);
                }
            }

            if (processedPacket.topic === '__circuit_open') {
                throw new Error(`Circuit open for node ${targetNodeID}`);
            }

            await this.transport.send(targetNodeID, processedPacket);

        } catch (err) {
            this.logger.error(`[MeshNetwork] Failed to send to ${targetNodeID}:`, {
                error: err instanceof Error ? err.message : String(err)
            });
        }
    }


    async publish<T>(topic: string, data: T): Promise<void> {
        try {
            let priority = 1;
            if (topic.startsWith('raft.') || topic.startsWith('kademlia.')) {
                priority = 2;
            }

            const primaryTransport = this.transport.getTransport();

            const packet: MeshPacket = {
                topic,
                data,
                id: `mesh_${Math.random().toString(36).substr(2, 9)}`,
                type: 'EVENT',
                senderNodeID: this.nodeID,
                namespace: this.namespace,
                timestamp: Date.now(),
                version: primaryTransport.version,
                priority,
                meta: {
                    ttl: 5,
                    path: [this.nodeID]
                }
            } as MeshPacket;

            return await this.transport.publish(topic, packet as MeshPacket);
        } catch (err) {
            this.logger.error(`[MeshNetwork] Failed to publish to ${topic}:`, {
                error: err instanceof Error ? err.message : String(err)
            });
        }
    }

    /**
     * Internal: Handles incoming packets from local sources (Broker loopback).
     */
    public handleIncoming(topic: string, data: unknown, options?: Partial<IMeshPacket>): void {
        this.logger.debug(`[MeshNetwork] handleIncoming for topic: ${topic}`);
        const packet: MeshPacket = {
            id: options?.id || `local_${Math.random().toString(36).substr(2, 9)}`,
            topic,
            data,
            type: (options?.type as MeshPacket['type']) || 'EVENT',
            senderNodeID: options?.senderNodeID || this.nodeID,
            timestamp: Date.now(),
            version: 1,
            priority: 1,
            meta: { ...options?.meta, local: true }
        } as MeshPacket;

        this.dispatcher.dispatch(packet).then(() => {
            this.logger.debug(`[MeshNetwork] Local dispatch complete for topic: ${topic}`);
        }).catch((err: Error | unknown) => {
            this.logger.error(`[MeshNetwork] Local dispatch error:`, {
                topic,
                error: err instanceof Error ? err.message : String(err)
            });
        });
    }

    private anyPacketHandlers: IMeshNetworkSubscriptionHandler<any>[] = [];

    onMessage<T>(topic: string, handler: IMeshNetworkSubscriptionHandler<T>): void {
        if (topic === '*') {
            this.anyPacketHandlers.push(handler);
        } else {
            this.dispatcher.on(topic, handler as (data: unknown, packet: MeshPacket) => void);
        }
    }

    unsubscribe<T>(topic: string, handler: IMeshNetworkSubscriptionHandler<T>): void {
        if (topic === '*') {
            this.anyPacketHandlers = this.anyPacketHandlers.filter(h => h !== handler);
        }
        // (dispatcher off skipped if not implemented)
    }
}
