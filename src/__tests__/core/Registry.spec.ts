import { Registry } from '../../core/Registry.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { DemoSkill } from '../../examples/demo/demo.service.js';
import type { NodeInfo } from '../../interfaces/IMeshNetwork.js';

describe('Registry', () => {
    let registry: Registry;
    const localNodeID = 'registry-test-node';

    const createNodeInfo = (nodeID: string, services: { name: string; tools?: Record<string, unknown> }[] = []): NodeInfo => ({
        nodeID,
        type: 'node',
        namespace: 'default',
        addresses: [],
        available: true,
        timestamp: Date.now(),
        nodeSeq: 1,
        hostname: 'localhost',
        services: services as any,
        trustLevel: 'internal',
        metadata: {},
        capabilities: { transports: ['ws'], features: [] },
        pid: process.pid,
        cpu: 0,
        activeRequests: 0,
        healthScore: 1.0
    });

    beforeEach(() => {
        registry = new Registry(new Logger(LogLevel.WARN), { localNodeID, preferLocal: true });
    });

    afterEach(async () => {
        await registry.stop();
    });

    // ─── node management ─────────────────────────────────────────────────────

    describe('registerNode / getNode / getNodes', () => {
        it('should auto-register the local node on construction', () => {
            const nodes = registry.getNodes();
            expect(nodes.length).toBeGreaterThanOrEqual(1);
            const local = registry.getNode(localNodeID);
            expect(local).toBeDefined();
            expect(local!.nodeID).toBe(localNodeID);
        });

        it('should register a remote node', () => {
            registry.registerNode(createNodeInfo('remote-1'));
            const node = registry.getNode('remote-1');
            expect(node).toBeDefined();
            expect(node!.nodeID).toBe('remote-1');
        });

        it('should update an existing node with higher nodeSeq', () => {
            const node = createNodeInfo('remote-2');
            registry.registerNode(node);

            const updated = createNodeInfo('remote-2');
            updated.nodeSeq = 2;
            updated.hostname = 'updated-host';
            registry.registerNode(updated);

            const fetched = registry.getNode('remote-2');
            expect(fetched!.hostname).toBe('updated-host');
        });

        it('should ignore updates with lower nodeSeq', () => {
            const node = createNodeInfo('remote-3');
            node.nodeSeq = 5;
            registry.registerNode(node);

            const stale = createNodeInfo('remote-3');
            stale.nodeSeq = 3;
            stale.hostname = 'stale-host';
            registry.registerNode(stale);

            const fetched = registry.getNode('remote-3');
            expect(fetched!.hostname).not.toBe('stale-host');
        });
    });

    // ─── unregister / available ──────────────────────────────────────────────

    describe('unregisterNode / getAvailableNodes', () => {
        it('should remove a node', () => {
            registry.registerNode(createNodeInfo('removable'));
            expect(registry.getNode('removable')).toBeDefined();

            registry.unregisterNode('removable');
            expect(registry.getNode('removable')).toBeUndefined();
        });

        it('should only return available nodes', () => {
            const node = createNodeInfo('available-test');
            node.available = false;
            registry.registerNode(node);

            const available = registry.getAvailableNodes();
            const found = available.find(n => n.nodeID === 'available-test');
            expect(found).toBeUndefined();
        });
    });

    // ─── heartbeat ───────────────────────────────────────────────────────────

    describe('heartbeat()', () => {
        it('should update cpu and activeRequests', () => {
            registry.registerNode(createNodeInfo('hb-node'));
            registry.heartbeat('hb-node', { cpu: 50, activeRequests: 10 });

            const node = registry.getNode('hb-node');
            expect(node!.cpu).toBe(50);
            expect(node!.activeRequests).toBe(10);
        });

        it('should compute healthScore', () => {
            registry.registerNode(createNodeInfo('health-node'));
            registry.heartbeat('health-node', { cpu: 0, activeRequests: 0 });

            const node = registry.getNode('health-node');
            expect(node!.healthScore).toBe(1.0);
        });
    });

    // ─── tool discovery ──────────────────────────────────────────────────────

    describe('findNodesForTool()', () => {
        it('should find nodes that advertise a tool', () => {
            registry.registerNode(createNodeInfo('tool-node-1', [
                { name: 'math', tools: { 'math.add': { name: 'math.add' } } }
            ]));
            registry.registerNode(createNodeInfo('tool-node-2', [
                { name: 'string', tools: { 'string.split': { name: 'string.split' } } }
            ]));

            const mathNodes = registry.findNodesForTool('math.add');
            expect(mathNodes).toHaveLength(1);
            expect(mathNodes[0].nodeID).toBe('tool-node-1');
        });

        it('should return empty for unknown tools', () => {
            const nodes = registry.findNodesForTool('nonexistent.tool');
            expect(nodes).toHaveLength(0);
        });
    });

    // ─── local module registration ──────────────────────────────────────────

    describe('registerLocalModule()', () => {
        it('should register module tools on the local node', () => {
            const demoSkill = new DemoSkill();
            registry.registerLocalModule(demoSkill);

            const nodes = registry.findNodesForTool('demo.hello');
            expect(nodes.length).toBeGreaterThanOrEqual(1);
            const local = nodes.find(n => n.nodeID === localNodeID);
            expect(local).toBeDefined();
        });
    });

    // ─── selectNode ─────────────────────────────────────────────────────────

    describe('selectNode()', () => {
        it('should prefer local node when preferLocal is true', () => {
            const demoSkill = new DemoSkill();
            registry.registerLocalModule(demoSkill);

            // Also add a remote node with the same tool
            registry.registerNode(createNodeInfo('remote-demo', [
                { name: 'demo', tools: { 'demo.hello': { name: 'demo.hello' } } }
            ]));

            const selected = registry.selectNode('demo.hello', { toolName: 'demo.hello', params: {} });
            expect(selected).toBeDefined();
            expect(selected!.nodeID).toBe(localNodeID);
        });
    });

    // ─── service names ──────────────────────────────────────────────────────

    describe('getServiceNames()', () => {
        it('should return unique service names across all nodes', () => {
            registry.registerNode(createNodeInfo('svc-1', [
                { name: 'auth', tools: {} },
                { name: 'users', tools: {} }
            ]));
            registry.registerNode(createNodeInfo('svc-2', [
                { name: 'auth', tools: {} },
                { name: 'billing', tools: {} }
            ]));

            const names = registry.getServiceNames();
            expect(names).toContain('auth');
            expect(names).toContain('users');
            expect(names).toContain('billing');
        });
    });

    // ─── waitFor ─────────────────────────────────────────────────────────────

    describe('waitForService()', () => {
        it('should resolve immediately if service exists', async () => {
            registry.registerNode(createNodeInfo('wait-node', [
                { name: 'ready-service', tools: {} }
            ]));
            await registry.waitForService('ready-service', 1000);
        });

        it('should timeout if service never appears', async () => {
            await expect(
                registry.waitForService('never-exists', 500)
            ).rejects.toThrow('Timeout');
        });
    });

    describe('waitForTool()', () => {
        it('should resolve immediately if tool exists', async () => {
            registry.registerNode(createNodeInfo('tool-wait-node', [
                { name: 'math', tools: { 'math.add': { name: 'math.add' } } }
            ]));
            await registry.waitForTool('math.add', 1000);
        });

        it('should timeout if tool never appears', async () => {
            await expect(
                registry.waitForTool('never.exists', 500)
            ).rejects.toThrow('Timeout');
        });
    });
});
