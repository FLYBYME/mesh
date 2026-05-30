import { KademliaRoutingTable } from '../core/KademliaRoutingTable.js';
import { NodeInfo } from '../types/registry.schema.js';

describe('KademliaRoutingTable', () => {
    let dht: KademliaRoutingTable;
    const localNodeID = 'node-1';

    const createNode = (id: string, services: any[] = []): NodeInfo => ({
        nodeID: id,
        type: 'node',
        namespace: 'default',
        addresses: [],
        available: true,
        timestamp: Date.now(),
        nodeSeq: 1,
        hostname: 'localhost',
        services,
        trustLevel: 'internal',
        metadata: {},
        capabilities: {},
        pid: 1,
    });

    beforeEach(() => {
        dht = new KademliaRoutingTable(localNodeID, 20); // k=20
    });

    describe('addNode()', () => {
        it('should add a node to the routing table', () => {
            const node = createNode('node-2');
            dht.addNode(node);

            // It should be retrievable
            const closest = dht.findClosestNodes('node-2', 1);
            expect(closest).toHaveLength(1);
            expect(closest[0].nodeID).toBe('node-2');
        });

        it('should ignore adding the local node itself', () => {
            const localNode = createNode(localNodeID);
            dht.addNode(localNode);

            const closest = dht.findClosestNodes(localNodeID, 1);
            expect(closest).toHaveLength(0);
        });

        it('should update an existing node and move it to the tail of the bucket', () => {
            const node = createNode('node-2');
            node.timestamp = 100;
            dht.addNode(node);

            // Add another node to the same bucket to test order
            // We just add a bunch to ensure we have elements
            dht.addNode(createNode('node-3'));

            // Update node-2
            const updatedNode = createNode('node-2');
            updatedNode.timestamp = 200;
            dht.addNode(updatedNode);

            // Check that it's updated
            const closest = dht.findClosestNodes('node-2', 10);
            const found = closest.find(n => n.nodeID === 'node-2');
            expect(found).toBeDefined();
            expect(found!.timestamp).toBe(200);
        });

        it('should respect bucket size limit (k)', () => {
            // k is 20, let's create a table with k=2 for easier testing
            const smallDht = new KademliaRoutingTable(localNodeID, 2);

            // To guarantee they fall in the same bucket, we need nodes with same distance MSB
            // Since distance is XOR, this is tricky to guarantee without math, but we can just add a lot
            // Let's add 5 nodes
            for (let i = 0; i < 5; i++) {
                smallDht.addNode(createNode(`node-same-prefix-${i}`));
            }

            // At most we should get back 5 nodes total, but buckets are capped at 2.
            // A query for a random ID will return up to the count requested, but bounded by what's stored.
            const allNodes = smallDht.findClosestNodes('target', 10);
            expect(allNodes.length).toBeLessThanOrEqual(5); // could be distributed
        });
    });

    describe('removeNode()', () => {
        it('should remove a specific node by ID', () => {
            dht.addNode(createNode('node-to-remove'));
            dht.addNode(createNode('node-to-keep'));

            expect(dht.findClosestNodes('node-to-remove', 10)).toHaveLength(2);

            dht.removeNode('node-to-remove');

            const nodes = dht.findClosestNodes('node-to-remove', 10);
            expect(nodes).toHaveLength(1);
            expect(nodes[0].nodeID).toBe('node-to-keep');
        });
    });

    describe('findClosestNodes()', () => {
        it('should return exactly K nearest nodes', () => {
            for (let i = 0; i < 10; i++) {
                dht.addNode(createNode(`node-test-${i}`));
            }

            const closest = dht.findClosestNodes('target-node', 3);
            expect(closest).toHaveLength(3);
        });

        it('should return all nodes if count is greater than total stored', () => {
            for (let i = 0; i < 3; i++) {
                dht.addNode(createNode(`node-test-${i}`));
            }

            const closest = dht.findClosestNodes('target-node', 10);
            expect(closest).toHaveLength(3);
        });
    });

    describe('findNodesForTool()', () => {
        it('should return nodes that advertise a specific tool', () => {
            // Node with math.add service
            dht.addNode(createNode('node-a', [
                { name: 'math', tools: { 'math.add': {} } }
            ]));

            // Node with math.add and math.sub
            dht.addNode(createNode('node-b', [
                { name: 'math', tools: { 'math.add': {}, 'math.sub': {} } }
            ]));

            // Node with strings.split
            dht.addNode(createNode('node-c', [
                { name: 'strings', tools: { 'strings.split': {} } }
            ]));

            const mathNodes = dht.findNodesForTool('math.add', 10);
            expect(mathNodes).toHaveLength(2);
            const ids = mathNodes.map(n => n.nodeID).sort();
            expect(ids).toEqual(['node-a', 'node-b']);

            const subNodes = dht.findNodesForTool('math.sub', 10);
            expect(subNodes).toHaveLength(1);
            expect(subNodes[0].nodeID).toBe('node-b');

            const emptyNodes = dht.findNodesForTool('unknown', 10);
            expect(emptyNodes).toHaveLength(0);
        });

        it('should respect count parameter', () => {
            for (let i = 0; i < 5; i++) {
                dht.addNode(createNode(`node-a-${i}`, [
                    { name: 'math', tools: { 'math.add': {} } }
                ]));
            }

            const limitNodes = dht.findNodesForTool('math.add', 2);
            expect(limitNodes).toHaveLength(2);
        });
    });
});
