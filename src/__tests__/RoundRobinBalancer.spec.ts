import { RoundRobinBalancer } from '../balancers/RoundRobinBalancer.js';
import { NodeInfo } from '../types/registry.schema.js';

describe('RoundRobinBalancer', () => {
    let balancer: RoundRobinBalancer;

    const createNode = (id: string): NodeInfo => ({
        nodeID: id,
        type: 'node',
        namespace: 'default',
        addresses: [],
        available: true,
        timestamp: Date.now(),
        nodeSeq: 1,
        hostname: 'localhost',
        services: [],
        trustLevel: 'internal',
        metadata: {},
        capabilities: {},
        pid: 1,
    });

    beforeEach(() => {
        balancer = new RoundRobinBalancer();
    });

    it('should return null for empty nodes array', () => {
        expect(balancer.select([])).toBeNull();
    });

    it('should return single node when only one exists', () => {
        const node = createNode('node-1');
        expect(balancer.select([node])).toBe(node);
        expect(balancer.select([node])).toBe(node);
    });

    it('should cycle through nodes in round-robin order', () => {
        const nodes = [
            createNode('node-1'),
            createNode('node-2'),
            createNode('node-3')
        ];

        // First pass
        expect(balancer.select(nodes)!.nodeID).toBe('node-1');
        expect(balancer.select(nodes)!.nodeID).toBe('node-2');
        expect(balancer.select(nodes)!.nodeID).toBe('node-3');

        // Second pass
        expect(balancer.select(nodes)!.nodeID).toBe('node-1');
        expect(balancer.select(nodes)!.nodeID).toBe('node-2');
        expect(balancer.select(nodes)!.nodeID).toBe('node-3');
    });

    it('should maintain separate counters per tool name', () => {
        const nodes = [
            createNode('node-1'),
            createNode('node-2')
        ];

        expect(balancer.select(nodes, { toolName: 'math.add' })!.nodeID).toBe('node-1');
        expect(balancer.select(nodes, { toolName: 'strings.split' })!.nodeID).toBe('node-1');

        expect(balancer.select(nodes, { toolName: 'math.add' })!.nodeID).toBe('node-2');
        expect(balancer.select(nodes, { toolName: 'strings.split' })!.nodeID).toBe('node-2');
    });

    it('should clear counters when MAX_COUNTERS is exceeded (Memory Leak Protection)', () => {
        const nodes = [createNode('node-1'), createNode('node-2')];

        // Populate 1001 counters to exceed MAX_COUNTERS (1000)
        for (let i = 0; i < 1001; i++) {
            balancer.select(nodes, { toolName: `tool-${i}` });
        }

        // At this point size is 1000. Next unique tool should trigger a clear.
        expect(balancer.select(nodes, { toolName: 'tool-trigger' })!.nodeID).toBe('node-1');

        // 'tool-0' should now be reset to 0 index instead of 1
        expect(balancer.select(nodes, { toolName: 'tool-0' })!.nodeID).toBe('node-1');
    });
});
