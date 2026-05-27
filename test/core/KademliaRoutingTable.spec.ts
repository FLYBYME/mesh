import { KademliaRoutingTable } from '../../src/core/KademliaRoutingTable.js';
import { NodeInfo } from '../../src/types/registry.schema.js';

describe('KademliaRoutingTable', () => {
    let rt: KademliaRoutingTable;
    const localID = 'local';

    beforeEach(() => {
        rt = new KademliaRoutingTable(localID, 2); // Small bucket size for testing splits/limit
    });

    test('should NOT add local node to buckets', () => {
        rt.addNode({ nodeID: localID } as any);
        expect(rt.findClosestNodes(localID, 10)).toHaveLength(0);
    });

    test('should add and remove nodes', () => {
        const node1 = { nodeID: 'node1', services: [] } as any;
        rt.addNode(node1);
        expect(rt.findClosestNodes('target', 10)).toHaveLength(1);

        rt.removeNode('node1');
        expect(rt.findClosestNodes('target', 10)).toHaveLength(0);
    });

    test('should update node and move to end of bucket on re-add', () => {
        const node1 = { nodeID: 'node1', services: [], metadata: { v: 1 } } as any;
        const node2 = { nodeID: 'node2', services: [] } as any;
        
        // We need them to be in the same bucket. 
        // Let's find two IDs that share a bucket index.
        // Or just use a very small table if it was easier, but bucketIndex depends on XOR distance.
        
        rt.addNode(node1);
        rt.addNode(node2);
        
        const node1Updated = { nodeID: 'node1', services: [], metadata: { v: 2 } } as any;
        rt.addNode(node1Updated);
        
        const closest = rt.findClosestNodes('target', 10);
        expect(closest.find(n => n.nodeID === 'node1')?.metadata?.v).toBe(2);
    });

    test('should respect bucket size limit', () => {
        rt = new KademliaRoutingTable(localID, 1);
        
        // Use IDs that are likely to fall into different buckets or same buckets
        // to test the limit.
        const node1 = { nodeID: 'node_a', services: [] } as any;
        const node2 = { nodeID: 'node_b', services: [] } as any;
        const node3 = { nodeID: 'node_c', services: [] } as any;

        rt.addNode(node1);
        rt.addNode(node2);
        rt.addNode(node3);

        const buckets = (rt as any).buckets as any[][];
        for (const bucket of buckets) {
            expect(bucket.length).toBeLessThanOrEqual(1);
        }
    });

    test('findClosestNodes should return nodes sorted by distance', () => {
        rt = new KademliaRoutingTable(localID, 20);
        const nodes = [];
        for (let i = 0; i < 20; i++) {
            nodes.push({ nodeID: `node_${Math.random().toString(36).substring(2, 11)}`, services: [] });
        }

        nodes.forEach(n => rt.addNode(n as any));

        const target = 'target_node';
        const closest = rt.findClosestNodes(target, 5);
        
        expect(closest.length).toBeGreaterThan(0);
        
        // Verify sorting
        const targetBigInt = (rt as any).getBigIntID(target);
        const distances = closest.map(n => targetBigInt ^ (rt as any).getBigIntID(n.nodeID));
        for (let i = 0; i < distances.length - 1; i++) {
            expect(distances[i] <= distances[i+1]).toBe(true);
        }
    });

    test('findClosestNodes should search multiple buckets if needed', () => {
        rt = new KademliaRoutingTable(localID, 100);
        // Add many nodes with diverse IDs
        for (let i = 0; i < 100; i++) {
            rt.addNode({ nodeID: `node_${i}_${Math.random().toString(36).substring(2, 7)}`, services: [] } as any);
        }

        const closest = rt.findClosestNodes('random_target', 50);
        expect(closest.length).toBe(50);
    });

    test('findNodesForTool should return nodes matching tool', () => {
        rt = new KademliaRoutingTable(localID, 20); // Larger bucket to avoid dropping
        rt.addNode({ nodeID: 'n1', services: [{ name: 'svc1', tools: { 't1': {} } }] } as any);
        rt.addNode({ nodeID: 'n2', services: [{ name: 'svc2', tools: { 't2': {} } }] } as any);
        rt.addNode({ nodeID: 'n3', services: [{ name: 'svc1', tools: { 't1': {} } }] } as any);

        const t1Nodes = rt.findNodesForTool('t1', 10);
        expect(t1Nodes).toHaveLength(2);
        const ids = t1Nodes.map(n => n.nodeID);
        expect(ids).toContain('n1');
        expect(ids).toContain('n3');

        const t2Nodes = rt.findNodesForTool('t2', 10);
        expect(t2Nodes).toHaveLength(1);
        expect(t2Nodes[0].nodeID).toBe('n2');
    });

    test('getBucketIndex should handle distance 0', () => {
        const index = (rt as any).getBucketIndex(BigInt(0));
        expect(index).toBe(0);
    });

    test('getBucketIndex should return correct index for various distances', () => {
        // distance 1 -> binary "1" -> length 1 -> index 0
        expect((rt as any).getBucketIndex(BigInt(1))).toBe(0);
        // distance 2 -> binary "10" -> length 2 -> index 1
        expect((rt as any).getBucketIndex(BigInt(2))).toBe(1);
        // distance 3 -> binary "11" -> length 2 -> index 1
        expect((rt as any).getBucketIndex(BigInt(3))).toBe(1);
        // distance 4 -> binary "100" -> length 3 -> index 2
        expect((rt as any).getBucketIndex(BigInt(4))).toBe(2);
    });

    test('toHex should pad and truncate to 64 chars', () => {
        const hex = (rt as any).toHex('abc');
        expect(hex).toHaveLength(64);
        expect(hex.startsWith('616263')).toBe(true);

        const longStr = 'a'.repeat(100);
        const hexLong = (rt as any).toHex(longStr);
        expect(hexLong).toHaveLength(64);
    });

    test('getBigIntID should cache the result', () => {
        const node = { nodeID: 'test' } as any;
        const id1 = (rt as any).getBigIntID('test', node);
        expect(node.cachedBigIntID).toBeDefined();
        
        const id2 = (rt as any).getBigIntID('test', node);
        expect(id1).toBe(id2);
    });

    test('removeNode should not throw if node not found', () => {
        expect(() => rt.removeNode('ghost')).not.toThrow();
    });

    test('findNodesForTool should respect count limit', () => {
        rt = new KademliaRoutingTable(localID, 20);
        rt.addNode({ nodeID: 'n1', services: [{ name: 's1', tools: { 't1': {} } }] } as any);
        rt.addNode({ nodeID: 'n2', services: [{ name: 's1', tools: { 't1': {} } }] } as any);
        rt.addNode({ nodeID: 'n3', services: [{ name: 's1', tools: { 't1': {} } }] } as any);

        const nodes = rt.findNodesForTool('t1', 2);
        expect(nodes).toHaveLength(2);
    });

    test('findClosestNodes should handle count larger than available nodes', () => {
        rt.addNode({ nodeID: 'n1', services: [] } as any);
        const closest = rt.findClosestNodes('target', 10);
        expect(closest).toHaveLength(1);
    });

    test('findClosestNodes should handle target being one of the nodes', () => {
        rt.addNode({ nodeID: 'target', services: [] } as any);
        const closest = rt.findClosestNodes('target', 10);
        expect(closest).toHaveLength(1);
        expect(closest[0].nodeID).toBe('target');
    });

    test('getBucketIndex should cap at 255', () => {
        // Distance with more than 256 bits
        const hugeDistance = BigInt('0x' + 'f'.repeat(100));
        expect((rt as any).getBucketIndex(hugeDistance)).toBe(255);
    });
});
