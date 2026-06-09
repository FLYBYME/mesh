import { IMeshNetworkNode, ServiceInfo, NodeInfo, MeshPacket } from '../interfaces/IMeshNetwork.js';
import type { ILogger } from '../interfaces/ILogger.js';
import { NetworkDispatcher } from './NetworkDispatcher.js';

interface AnnounceData {
    nodeSeq?: number;
    hostname?: string;
    services?: ServiceInfo[];
}

interface RPCRequestData {
    tool: string;
}

interface PexData {
    peers: Partial<NodeInfo>[];
}

interface PresenceData {
    node: NodeInfo;
}

/**
 * NetworkController - Handles standard mesh packets.
 */
export class NetworkController {
    constructor(
        private node: IMeshNetworkNode,
        private logger: ILogger
    ) { }

    public registerHandlers(dispatcher: NetworkDispatcher): void {
        dispatcher.on('$node.ping', (_data, packet) => this.handlePing(packet));
        dispatcher.on('$node.pong', (data, packet) => this.handlePong(data as Record<string, unknown>, packet));
        dispatcher.on('$node.pex', (data, _packet) => this.handlePex(data as PexData));
        dispatcher.on('$node.presence', (data, _packet) => this.handlePresence(data as PresenceData));
        dispatcher.on('$node.announce', (data, packet) => this.handleAnnounce(data as AnnounceData, packet));
        dispatcher.on('$rpc.request', (data, packet) => this.handleRPCRequest(data as RPCRequestData, packet));
        dispatcher.on('$rpc.response', (data, packet) => this.handleRPCResponse(data as Record<string, unknown>, packet));
    }

    private async handleAnnounce(data: AnnounceData, packet: MeshPacket): Promise<void> {
        if (packet.senderNodeID === this.node.nodeID) return;
        this.node.registry.registerNode({
            nodeID: packet.senderNodeID,
            type: 'node',
            namespace: 'default', // Ideally from data or config
            addresses: [],
            available: true,
            timestamp: Date.now(),
            nodeSeq: data.nodeSeq || 0,
            hostname: data.hostname || 'unknown',
            services: data.services || [],
            trustLevel: 'public',
            metadata: {},
            capabilities: {},
            pid: 0
        });
    }

    private async handlePing(packet: MeshPacket): Promise<void> {
        if (packet.senderNodeID === this.node.nodeID) return;
        this.node.registry.heartbeat(packet.senderNodeID);
        this.node.publish('$node.pong', { id: packet.id, timestamp: Date.now() });
    }

    private async handlePong(_data: Record<string, unknown>, packet: MeshPacket): Promise<void> {
        this.node.registry.heartbeat(packet.senderNodeID);
        this.logger.debug('Ping response received', { from: packet.senderNodeID, internal: true });
    }

    private async handlePex(data: PexData): Promise<void> {
        if (this.node.orchestrator && data.peers) {
            this.node.orchestrator.handlePEX(data);
        }
    }

    private async handlePresence(data: PresenceData): Promise<void> {
        this.logger.debug(`HandlePresence called for node`, {
            hasOrchestrator: !!this.node.orchestrator,
            hasDataNode: !!data?.node,
            internal: true
        });
        if (this.node.orchestrator && data.node) {
            this.node.orchestrator.handlePresence(data);
        }
    }

    private async handleRPCRequest(data: RPCRequestData, _packet: MeshPacket): Promise<void> {
        this.logger.debug('Incoming RPC request', { tool: data.tool, internal: true });
    }

    private async handleRPCResponse(_data: Record<string, unknown>, _packet: MeshPacket): Promise<void> {
        // Handled by Transport internally if it has correlation logic
    }
}
