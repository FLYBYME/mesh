import type { NodeInfo } from '../types/registry.schema';

interface InternalNodeInfo extends NodeInfo {
    cachedBigIntID?: string;
}

/**
 * KademliaRoutingTable — XOR-distance based node organization.
 */
export class KademliaRoutingTable {
    private buckets: NodeInfo[][] = [];
    private localNodeID: string;
    private localBigIntID: bigint;
    private bucketSize: number;
    public readonly k = 20;

    constructor(localNodeID: string, bucketSize = 20) {
        this.localNodeID = localNodeID;
        this.localBigIntID = this.getBigIntID(localNodeID);
        this.bucketSize = bucketSize;
        // Initialize 256 buckets for XOR distance
        for (let i = 0; i < 256; i++) {
            this.buckets[i] = [];
        }
    }

    private getBigIntID(id: string, node?: NodeInfo): bigint {
        const cachedNode = node as InternalNodeInfo | undefined;
        if (cachedNode && cachedNode.cachedBigIntID) return BigInt(cachedNode.cachedBigIntID);
        const bi = BigInt('0x' + this.toHex(id));
        if (cachedNode) cachedNode.cachedBigIntID = bi.toString();
        return bi;
    }

    addNode(info: NodeInfo): void {
        if (info.nodeID === this.localNodeID) return;

        const infoBigInt = this.getBigIntID(info.nodeID, info);
        const distance = this.localBigIntID ^ infoBigInt;
        const bucketIndex = this.getBucketIndex(distance);
        const bucket = this.buckets[bucketIndex];

        const existingIndex = bucket.findIndex(n => n.nodeID === info.nodeID);
        if (existingIndex !== -1) {
            bucket[existingIndex] = info; // Update
            const node = bucket.splice(existingIndex, 1)[0];
            bucket.push(node);
        } else if (bucket.length < this.bucketSize) {
            bucket.push(info);
        }
    }

    removeNode(nodeID: string): void {
        const targetBigInt = this.getBigIntID(nodeID);
        const distance = this.localBigIntID ^ targetBigInt;
        const bucketIndex = this.getBucketIndex(distance);
        const bucket = this.buckets[bucketIndex];
        const index = bucket.findIndex(n => n.nodeID === nodeID);
        if (index !== -1) {
            bucket.splice(index, 1);
        }
    }

    findClosestNodes(targetID: string, count: number): NodeInfo[] {
        const targetBigInt = this.getBigIntID(targetID);
        const bucketIndex = this.getBucketIndex(this.localBigIntID ^ targetBigInt);
        const results: { node: NodeInfo, distance: bigint }[] = [];

        const addFromBucket = (idx: number) => {
            for (const node of this.buckets[idx]) {
                results.push({
                    node,
                    distance: targetBigInt ^ this.getBigIntID(node.nodeID, node)
                });
            }
        };

        // Scan starting from the target's bucket and move outwards
        addFromBucket(bucketIndex);
        for (let i = 1; results.length < count && (bucketIndex - i >= 0 || bucketIndex + i < 256); i++) {
            if (bucketIndex - i >= 0) addFromBucket(bucketIndex - i);
            if (bucketIndex + i < 256) addFromBucket(bucketIndex + i);
        }

        return results
            .sort((a, b) => (a.distance < b.distance ? -1 : a.distance > b.distance ? 1 : 0))
            .slice(0, count)
            .map(item => item.node);
    }

    findNodesForService(serviceName: string, count: number): NodeInfo[] {
        const results: NodeInfo[] = [];
        for (const bucket of this.buckets) {
            for (const node of bucket) {
                if (node.services.some(s => s.name === serviceName || s.fullName === serviceName)) {
                    results.push(node);
                }
                if (results.length >= count) return results;
            }
        }
        return results;
    }

    private getBucketIndex(distance: bigint): number {
        if (distance === BigInt(0)) return 0;
        return Math.min(255, distance.toString(2).length - 1);
    }

    private toHex(str: string): string {
        let res = '';
        for (let i = 0; i < str.length; i++) {
            res += str.charCodeAt(i).toString(16).padStart(2, '0');
        }
        return res.padEnd(64, '0').slice(0, 64);
    }
}
