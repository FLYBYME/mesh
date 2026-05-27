import { Registry } from '../../src/core/Registry.js';
import { RoundRobinBalancer } from '../../src/balancers/RoundRobinBalancer.js';
import { ILogger } from '../../src/interfaces/ILogger.js';
import { ToolContract } from '../../src/interfaces/IToolContract.js';
import { IServiceModule } from '../../src/interfaces/IServiceModule.js';

describe('Registry', () => {
    let registry: Registry;
    let mockLogger: jest.Mocked<ILogger>;

    beforeEach(() => {
        mockLogger = {
            info: jest.fn(),
            debug: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            child: jest.fn().mockReturnThis(),
        } as any;
        registry = new Registry(mockLogger, { localNodeID: 'local-node', ttl: 1000 });
        jest.useFakeTimers();
    });

    afterEach(() => {
        registry.stop();
        jest.useRealTimers();
    });

    test('should initialize with local node', () => {
        const nodes = registry.getNodes();
        expect(nodes).toHaveLength(1);
        expect(nodes[0].nodeID).toBe('local-node');
    });

    test('should register and unregister a node', () => {
        const nodeInfo: any = {
            nodeID: 'remote-node',
            type: 'node',
            services: [],
            available: true,
        };
        registry.registerNode(nodeInfo);
        expect(registry.getNodes()).toHaveLength(2);
        expect(registry.getNode('remote-node')).toBeDefined();

        registry.unregisterNode('remote-node');
        expect(registry.getNodes()).toHaveLength(1);
        expect(registry.getNode('remote-node')).toBeUndefined();
    });

    test('should update node if seq is higher', () => {
        const nodeV1: any = { nodeID: 'node1', nodeSeq: 1, metadata: { v: 1 }, services: [] };
        const nodeV2: any = { nodeID: 'node1', nodeSeq: 2, metadata: { v: 2 }, services: [] };
        
        registry.registerNode(nodeV1);
        expect(registry.getNode('node1')?.metadata?.v).toBe(1);
        
        registry.registerNode(nodeV2);
        expect(registry.getNode('node1')?.metadata?.v).toBe(2);
        expect(registry.getNode('node1')?.nodeSeq).toBe(2);
    });

    test('should NOT update node if seq is lower', () => {
        const nodeV1: any = { nodeID: 'node1', nodeSeq: 2, metadata: { v: 2 }, services: [] };
        const nodeV2: any = { nodeID: 'node1', nodeSeq: 1, metadata: { v: 1 }, services: [] };
        
        registry.registerNode(nodeV1);
        registry.registerNode(nodeV2);
        expect(registry.getNode('node1')?.metadata?.v).toBe(2);
    });

    test('should handle heartbeat and health scoring', () => {
        const nodeInfo: any = { nodeID: 'node1', services: [], available: true };
        registry.registerNode(nodeInfo);
        
        const startTime = Date.now();
        registry.heartbeat('node1', { cpu: 50, activeRequests: 10 });
        
        const node = registry.getNode('node1')!;
        expect(node.cpu).toBe(50);
        expect(node.activeRequests).toBe(10);
        // healthScore = 1.0 - (50/100) - (10/50) = 1.0 - 0.5 - 0.2 = 0.3
        expect(node.healthScore).toBeCloseTo(0.3);
        expect(node.timestamp).toBeGreaterThanOrEqual(startTime);
    });

    test('should prune stale nodes', async () => {
        const nodeInfo: any = { nodeID: 'stale-node', services: [], available: true };
        registry.registerNode(nodeInfo);
        
        await registry.start();
        
        // Advance time past TTL (1000ms)
        jest.advanceTimersByTime(5000); // Pruning runs every 5000ms by default in start()
        
        // Wait for prune interval to run
        expect(registry.getNode('stale-node')).toBeUndefined();
    });

    test('should mark node offline before pruning', () => {
        const nodeInfo: any = { nodeID: 'dying-node', services: [], available: true };
        registry.registerNode(nodeInfo);
        
        // Set timestamp to be old but not pruned yet (age > 10000ms for offline, but our TTL is 1000)
        // Wait, if TTL is 1000, it will be pruned before being marked offline if we use the default start() logic.
        // Let's use a larger TTL for this test.
        const longTtlRegistry = new Registry(mockLogger, { localNodeID: 'local', ttl: 60000 });
        longTtlRegistry.registerNode(nodeInfo);
        
        // Manually trigger pruning with long TTL
        const node = (longTtlRegistry as any).nodes.get('dying-node');
        node.timestamp = Date.now() - 15000; // 15s old
        
        (longTtlRegistry as any).pruneStaleNodes(60000);
        
        expect(longTtlRegistry.getNode('dying-node')?.available).toBe(false);
    });

    test('waitForService should resolve when service is registered', async () => {
        const promise = registry.waitForService('my-service', 1000);
        
        const nodeInfo: any = { 
            nodeID: 'node1', 
            services: [{ name: 'my-service', version: '1.0.0', tools: {} }], 
            available: true 
        };
        registry.registerNode(nodeInfo);
        
        await expect(promise).resolves.toBeUndefined();
    });

    test('waitForService should timeout if service is not found', async () => {
        const promise = registry.waitForService('non-existent', 100);
        jest.advanceTimersByTime(200);
        await expect(promise).rejects.toThrow('Timeout');
    });

    test('waitForNodes should resolve when enough nodes are available', async () => {
        const promise = registry.waitForNodes(2, 1000);
        
        registry.registerNode({ nodeID: 'node1', services: [], available: true } as any);
        
        await expect(promise).resolves.toBeUndefined();
    });

    test('waitForTool should resolve when tool is found', async () => {
        const promise = registry.waitForTool('my-tool', 1000);
        
        const nodeInfo: any = { 
            nodeID: 'node1', 
            services: [{ 
                name: 'svc1', 
                tools: { 'my-tool': { name: 'my-tool' } } 
            }], 
            available: true 
        };
        registry.registerNode(nodeInfo);
        
        await expect(promise).resolves.toBeUndefined();
    });

    test('registerLocalModule should update local node services', () => {
        const mockModule: jest.Mocked<IServiceModule> = {
            domain: 'test-svc',
            getContracts: jest.fn().mockReturnValue([
                { domain: 'test-svc', action: 'doWork', description: 'test' }
            ]),
        } as any;
        
        registry.registerLocalModule(mockModule);
        
        const localNode = registry.getNode('local-node')!;
        expect(localNode.services).toHaveLength(1);
        expect(localNode.services[0].name).toBe('test-svc');
        expect((localNode.services[0] as any).tools['test-svc.doWork']).toBeDefined();
    });

    test('getNextToolEndpoint should prefer local service', () => {
        // Register local service
        const mockModule: any = {
            domain: 'svc',
            getContracts: () => [{ domain: 'svc', action: 'act' }]
        };
        registry.registerLocalModule(mockModule);

        // Register remote service
        registry.registerNode({
            nodeID: 'remote',
            services: [{ name: 'svc', tools: { 'svc.act': {} } }],
            available: true
        } as any);

        const endpoint = registry.getNextToolEndpoint('svc.act');
        expect(endpoint?.nodeID).toBe('local-node');
    });

    test('getNextToolEndpoint should use balancer for remote nodes', () => {
        const registryNoLocal = new Registry(mockLogger, { localNodeID: 'local', preferLocal: false });
        
        registryNoLocal.registerNode({
            nodeID: 'node1',
            services: [{ name: 'svc', tools: { 'tool': {} } }],
            available: true
        } as any);
        registryNoLocal.registerNode({
            nodeID: 'node2',
            services: [{ name: 'svc', tools: { 'tool': {} } }],
            available: true
        } as any);

        const node1 = registryNoLocal.getNode('node1')!;
        const node2 = registryNoLocal.getNode('node2')!;

        const endpoint1 = registryNoLocal.getNextToolEndpoint('tool');
        const endpoint2 = registryNoLocal.getNextToolEndpoint('tool');
        
        // RoundRobin should toggle
        expect([endpoint1?.nodeID, endpoint2?.nodeID]).toContain('node1');
        expect([endpoint1?.nodeID, endpoint2?.nodeID]).toContain('node2');
        expect(endpoint1?.nodeID).not.toBe(endpoint2?.nodeID);
    });

    test('findNodesForTool should return all nodes having the tool', () => {
        registry.registerNode({
            nodeID: 'node1',
            services: [{ name: 'svc', tools: { 't1': {} } }],
            available: true
        } as any);
        registry.registerNode({
            nodeID: 'node2',
            services: [{ name: 'svc', tools: { 't1': {} } }],
            available: true
        } as any);
        registry.registerNode({
            nodeID: 'node3',
            services: [{ name: 'svc', tools: { 't2': {} } }],
            available: true
        } as any);

        expect(registry.findNodesForTool('t1')).toHaveLength(2);
        expect(registry.findNodesForTool('t2')).toHaveLength(1);
        expect(registry.findNodesForTool('t3')).toHaveLength(0);
    });

    test('heartbeat should update health score based on CPU and requests', () => {
        registry.registerNode({ nodeID: 'n1', available: true, services: [] } as any);
        
        // Ideal
        registry.heartbeat('n1', { cpu: 0, activeRequests: 0 });
        expect(registry.getNode('n1')?.healthScore).toBe(1.0);

        // Heavy CPU
        registry.heartbeat('n1', { cpu: 100, activeRequests: 0 });
        expect(registry.getNode('n1')?.healthScore).toBe(0);

        // Heavy Requests
        registry.heartbeat('n1', { cpu: 0, activeRequests: 50 });
        expect(registry.getNode('n1')?.healthScore).toBe(0);
        
        // Mid
        registry.heartbeat('n1', { cpu: 50, activeRequests: 25 });
        // 1.0 - 0.5 - 0.5 = 0
        expect(registry.getNode('n1')?.healthScore).toBe(0);
    });

    test('unregisterModule should remove service from local node', () => {
        const mockModule: any = {
            domain: 'svc1',
            getContracts: () => [{ domain: 'svc1', action: 'act' }]
        };
        registry.registerLocalModule(mockModule);
        expect(registry.getNode('local-node')?.services).toHaveLength(1);

        registry.unregisterModule('svc1');
        expect(registry.getNode('local-node')?.services).toHaveLength(0);
    });

    test('updateLocalMetrics should trigger local:changed event', () => {
        const spy = jest.fn();
        registry.on('local:changed', spy);
        
        (registry as any).updateLocalMetrics();
        
        expect(spy).toHaveBeenCalled();
    });

    test('listModules, getModule should work', () => {
        const mockModule: any = {
            domain: 'svc1',
            getContracts: () => []
        };
        registry.registerLocalModule(mockModule);
        
        expect(registry.listModules()).toContain(mockModule);
        expect(registry.getModule('svc1')).toBe(mockModule);
    });

    test('registerTool, getTool, getTools should work', () => {
        const contract: any = { domain: 'd', action: 'a' };
        registry.registerTool(contract);
        
        expect(registry.getTool('d.a')).toBe(contract);
        expect(registry.getTools()).toContain(contract);
    });

    test('getAvailableNodes should only return available nodes', () => {
        registry.registerNode({ nodeID: 'n1', available: true, services: [] } as any);
        registry.registerNode({ nodeID: 'n2', available: false, services: [] } as any);
        
        const available = registry.getAvailableNodes();
        expect(available.find(n => n.nodeID === 'n1')).toBeDefined();
        expect(available.find(n => n.nodeID === 'n2')).toBeUndefined();
    });

    test('selectNode should return IServiceNode', () => {
        registry.registerNode({
            nodeID: 'n1',
            available: true,
            services: [{ name: 's1', tools: { 't1': {} } }],
            metadata: { meta: 'data' }
        } as any);

        const node = registry.selectNode('t1');
        expect(node?.nodeID).toBe('n1');
        expect(node?.services).toContain('s1');
        expect(node?.metadata).toEqual({ meta: 'data' });
    });

    test('should update timestamp on same nodeSeq', () => {
        const node: any = { nodeID: 'n1', nodeSeq: 1, available: true, services: [] };
        registry.registerNode(node);
        const t1 = registry.getNode('n1')?.timestamp || 0;
        
        jest.advanceTimersByTime(100);
        registry.registerNode(node);
        const t2 = registry.getNode('n1')?.timestamp || 0;
        
        expect(t2).toBeGreaterThan(t1);
    });

    test('unregisterNode should emit changed if node existed', () => {
        registry.registerNode({ nodeID: 'n1', services: [] } as any);
        const spy = jest.fn();
        registry.on('changed', spy);
        
        registry.unregisterNode('n1');
        expect(spy).toHaveBeenCalledWith('n1');
        
        spy.mockClear();
        registry.unregisterNode('non-existent');
        expect(spy).not.toHaveBeenCalled();
    });

    test('findNodesForTool should handle qualified names', () => {
        registry.registerNode({
            nodeID: 'n1',
            services: [{ name: 'svc', tools: { 'tool': {} } }],
            available: true
        } as any);
        
        expect(registry.findNodesForTool('svc.tool')).toHaveLength(1);
    });

    test('getServiceNames should return names of services from available nodes', () => {
        registry.registerNode({
            nodeID: 'n1',
            services: [{ name: 's1' }],
            available: true
        } as any);
        registry.registerNode({
            nodeID: 'n2',
            services: [{ name: 's2' }],
            available: false
        } as any);
        
        const names = registry.getServiceNames();
        expect(names).toContain('s1');
        expect(names).not.toContain('s2');
    });

    test('setBalancer should change the selection strategy', () => {
        const mockBalancer: any = { select: jest.fn() };
        registry.setBalancer(mockBalancer);
        
        registry.registerNode({
            nodeID: 'n1',
            services: [{ name: 's1', tools: { 't1': {} } }],
            available: true
        } as any);
        
        registry.getNextToolEndpoint('t1');
        // RoundRobin is used initially, but we replaced it.
        // Wait, getNextToolEndpoint uses this.balancer.select
        expect(mockBalancer.select).toHaveBeenCalled();
    });

    test('should use default localNodeID if not provided', () => {
        const r = new Registry(mockLogger);
        expect(r.getNodes()[0].nodeID).toMatch(/^node_/);
    });
});
