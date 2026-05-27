import { BaseTransport } from '../BaseTransport.js';
import { BaseSerializer } from '../../serializers/BaseSerializer.js';
import type { TransportConnectOptions, MeshPacket } from '../../interfaces/IMeshNetwork.js';

/**
 * WebRTCTransport — Browser-to-Browser / Browser-to-Node NAT Traversal.
 * Integrates STUN/TURN/ICE for enterprise firewall negotiation.
 */
export class WebRTCTransport extends BaseTransport {
    readonly protocol = 'webrtc';
    readonly version = 1;
    private peers = new Map<string, { pc: RTCPeerConnection, dc: RTCDataChannel }>();
    private iceServers: RTCIceServer[];

    constructor(serializer: BaseSerializer, iceServers?: RTCIceServer[]) {
        super(serializer);
        this.iceServers = iceServers || [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ];
    }

    async connect(opts: TransportConnectOptions): Promise<void> {
        this.nodeID = opts.nodeID;
        this.connected = true;
        this.emit('connected');
    }

    async disconnect(): Promise<void> {
        for (const peer of this.peers.values()) {
            peer.dc.close();
            peer.pc.close();
        }
        this.peers.clear();
        this.connected = false;
        this.emit('disconnected');
    }

    async send(nodeID: string, packet: MeshPacket): Promise<void> {
        const peer = this.peers.get(nodeID);
        if (!peer || peer.dc.readyState !== 'open') {
            throw new Error(`WebRTC DataChannel not open for node ${nodeID}`);
        }
        const payload = this.serializer.serialize(packet);
        peer.dc.send(payload.slice().buffer as ArrayBuffer);
    }

    async publish(topic: string, packet: MeshPacket): Promise<void> {
        for (const peer of this.peers.values()) {
            if (peer.dc.readyState === 'open') {
                peer.dc.send(this.serializer.serialize(packet).slice().buffer as ArrayBuffer);
            }
        }
    }

    /**
     * Create an offer for a new peer connection.
     */
    async createOffer(nodeID: string): Promise<RTCSessionDescriptionInit> {
        const pc = new RTCPeerConnection({ iceServers: this.iceServers });
        const dc = pc.createDataChannel('mesh-data', { ordered: true });

        this.setupDataChannel(nodeID, pc, dc);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        return offer;
    }

    private setupDataChannel(nodeID: string, pc: RTCPeerConnection, dc: RTCDataChannel) {
        dc.onmessage = (ev) => {
            const packet = this.serializer.deserialize(ev.data as Uint8Array) as MeshPacket;
            this.emit('packet', packet);
        };

        dc.onopen = () => this.emit('peer:connect', nodeID);
        dc.onclose = () => {
            this.peers.delete(nodeID);
            this.emit('peer:disconnect', nodeID);
        };

        this.peers.set(nodeID, { pc, dc });
    }
}
