import { EventEmitter } from 'eventemitter3';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { NodeInfo as RegistryNodeInfo, ServiceInfo as RegistryServiceInfo, ToolInfo as RegistryToolInfo } from '../types/registry.schema.js';
import type { ILogger } from '../interfaces/ILogger.js';
import { BaseBalancer } from '../balancers/BaseBalancer.js';
import { RoundRobinBalancer } from '../balancers/RoundRobinBalancer.js';
import { KademliaRoutingTable } from './KademliaRoutingTable.js';
import type { IServiceRegistry } from '../interfaces/IServiceRegistry.js';
import type { NodeInfo as CoreNodeInfo, IServiceNode } from '../interfaces/IMeshNetwork.js';
import type { IServiceModule } from '../interfaces/IServiceModule.js';
import { ToolContract, toolKey } from '../interfaces/IToolContract.js';

// Platform-agnostic OS check
const getHostname = () => {
    try {
        const os = eval('require')('os');
        return os.hostname();
    } catch {
        return 'browser-client';
    }
};

/**
 * Registry — manages the collection of known nodes and their services.
 * Bridges the local Zod schemas with the core interface.
 */
export class Registry extends EventEmitter implements IServiceRegistry {
    private nodes = new Map<string, RegistryNodeInfo>();
    private tools = new Map<string, ToolContract>();
    private dht: KademliaRoutingTable | null = null;
    private balancer: BaseBalancer;
    private preferLocal: boolean;
    private localNodeID: string;
    private dhtEnabled: boolean;
    private pruningTimer?: NodeJS.Timeout;
    private metricsTimer?: NodeJS.Timeout;
    private ttl: number;

    private localModules = new Map<string, IServiceModule>();

    constructor(
        private logger: ILogger,
        options: { preferLocal?: boolean; localNodeID?: string; dhtEnabled?: boolean; ttl?: number } = {}
    ) {
        super();
        this.preferLocal = options.preferLocal ?? true;
        this.localNodeID = options.localNodeID || `node_${Math.random().toString(36).substr(2, 9)}`;
        this.dhtEnabled = options.dhtEnabled ?? false;
        this.ttl = options.ttl || 30000;
        this.balancer = new RoundRobinBalancer();

        if (this.dhtEnabled) {
            this.dht = new KademliaRoutingTable(this.localNodeID);
        }

        // Initialize local node entry
        this.registerNode({
            nodeID: this.localNodeID,
            type: 'node',
            namespace: 'default',
            addresses: [],
            available: true,
            timestamp: Date.now(),
            bootedAt: Date.now(),
            nodeSeq: 1,
            hostname: getHostname(),
            services: [],
            trustLevel: 'internal',
            metadata: {},
            capabilities: {
                transports: ['ws'],
                features: ['relay']
            },
            pid: typeof process !== 'undefined' ? process.pid : 0,
            cpu: 0,
            activeRequests: 0,
            healthScore: 1.0
        });
    }

    public async waitForService(serviceName: string, timeoutMs = 15000): Promise<void> {
        const isAvailable = () => this.getServiceNames().includes(serviceName);
        if (isAvailable()) return;

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.off('changed', check);
                reject(new Error(`Timeout: Service "${serviceName}" not found after ${timeoutMs}ms`));
            }, timeoutMs);
            if (timer.unref) timer.unref();

            const check = () => {
                if (isAvailable()) {
                    clearTimeout(timer);
                    this.off('changed', check);
                    resolve();
                }
            };

            this.on('changed', check);
        });
    }

    public async waitForNodes(count: number, timeoutMs = 15000): Promise<void> {
        if (this.getAvailableNodes().length >= count) return;

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.off('changed', check);
                reject(new Error(`Timeout: Only ${this.getAvailableNodes().length}/${count} nodes found`));
            }, timeoutMs);
            if (timer.unref) timer.unref();

            const check = () => {
                if (this.getAvailableNodes().length >= count) {
                    clearTimeout(timer);
                    this.off('changed', check);
                    resolve();
                }
            };

            this.on('changed', check);
        });
    }

    public async waitForTool(toolName: string, timeoutMs = 15000): Promise<void> {
        const isAvailable = () => this.findNodesForTool(toolName).length > 0;
        if (isAvailable()) return;

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.off('changed', check);
                this.logger.info('Registry state on timeout:', this);
                reject(new Error(`Timeout: Tool "${toolName}" not found after ${timeoutMs}ms`));
            }, timeoutMs);
            if (timer.unref) timer.unref();

            const check = () => {
                if (isAvailable()) {
                    clearTimeout(timer);
                    this.off('changed', check);
                    resolve();
                }
            };

            this.on('changed', check);
        });
    }

    public async start(): Promise<void> {
        if (this.pruningTimer) return;
        this.pruningTimer = setInterval(() => this.pruneStaleNodes(this.ttl), 5000);
        if (this.pruningTimer.unref) this.pruningTimer.unref();

        this.metricsTimer = setInterval(() => this.updateLocalMetrics(), 10000);
        if (this.metricsTimer.unref) this.metricsTimer.unref();

        this.logger.info(`Registry started for node ${this.localNodeID}`);
    }

    public async stop(): Promise<void> {
        if (this.pruningTimer) {
            clearInterval(this.pruningTimer);
            this.pruningTimer = undefined;
        }
        if (this.metricsTimer) {
            clearInterval(this.metricsTimer);
            this.metricsTimer = undefined;
        }
    }

    private updateLocalMetrics(): void {
        const localNode = this.nodes.get(this.localNodeID);
        if (!localNode) return;

        try {
            if (typeof process !== 'undefined' && process.release?.name === 'node') {
                const os = require('os');

                // CPU load approximation
                const cpus = os.cpus();
                if (cpus && cpus.length > 0) {
                    const loadAvg = os.loadavg();
                    const cpuUsage = (loadAvg[0] / cpus.length) * 100;
                    localNode.cpu = Math.round(Math.min(Math.max(cpuUsage, 0), 100));
                }

                // RAM usage approximation
                const totalMem = os.totalmem();
                if (totalMem > 0) {
                    const ramUsage = (process.memoryUsage().rss / totalMem) * 100;
                    localNode.activeRequests = Math.round(ramUsage * 100);
                }
            } else {
                // Browser or lightweight environment: Mock baseline metrics
                localNode.cpu = Math.round(Math.random() * 20);
                localNode.activeRequests = Math.round(Math.random() * 40 * 100);
            }

            localNode.timestamp = Date.now();
            this.emit('local:changed'); // Triggers MeshOrchestrator to broadcast updated presence
        } catch {
            // Ignore if 'os' is not resolvable
        }
    }

    public listModules(): IServiceModule[] {
        return Array.from(this.localModules.values());
    }

    public registerModule(module: IServiceModule): void {
        this.registerLocalModule(module);
    }

    public unregisterModule(domain: string): void {
        this.localModules.delete(domain);
        const localNode = this.nodes.get(this.localNodeID);
        if (localNode) {
            localNode.services = localNode.services.filter(s => s.name !== domain);
            localNode.nodeSeq++;
            this.registerNode(localNode as unknown as CoreNodeInfo);
        }
    }

    public getModule(domain: string): IServiceModule | undefined {
        return this.localModules.get(domain);
    }

    public unregisterNode(nodeID: string): void {
        if (this.nodes.delete(nodeID)) {
            if (this.dht) this.dht.removeNode(nodeID);
            this.emit('changed', nodeID);
        }
    }

    public heartbeat(nodeID: string, data?: { cpu?: number; activeRequests?: number }): void {
        const node = this.nodes.get(nodeID);
        if (node) {
            node.timestamp = Date.now();
            if (data) {
                if (data.cpu !== undefined) node.cpu = data.cpu;
                if (data.activeRequests !== undefined) node.activeRequests = data.activeRequests;
            }

            // Normalized healthScore: 1.0 (ideal) -> 0.0 (overloaded)
            const cpu = node.cpu || 0;
            const requests = node.activeRequests || 0;
            node.healthScore = Math.max(0, 1.0 - (cpu / 100) - (requests / 50));

            this.emit('heartbeat', nodeID);
        }
    }

    public findNodesForTool(toolName: string): CoreNodeInfo[] {
        const results: RegistryNodeInfo[] = [];
        for (const node of this.nodes.values()) {
            if (!node.available) continue;
            for (const svc of node.services) {
                if (!svc.tools) continue;

                let tool = svc.tools[toolName];
                if (!tool && toolName.includes('.')) {
                    const parts = toolName.split('.');
                    if (parts[0] === svc.name) {
                        tool = svc.tools[parts[1]];
                    }
                }

                if (tool) {
                    results.push(node);
                    break;
                }
            }
        }
        return results as unknown as CoreNodeInfo[];
    }

    public selectNode(toolName: string, context?: { toolName: string, params: Record<string, unknown> }): IServiceNode | undefined {
        const endpoint = this.getNextToolEndpoint(toolName);
        if (!endpoint) return undefined;

        const node = this.nodes.get(endpoint.nodeID);
        if (!node) return undefined;

        return {
            nodeID: node.nodeID,
            services: node.services.map(s => s.name),
            metadata: node.metadata
        };
    }

    public registerNode(node: CoreNodeInfo): void {
        const existing = this.nodes.get(node.nodeID);

        // Normalize addresses for better matching (e.g. localhost -> 127.0.0.1)
        const normalizeAddr = (addr: string) => addr.replace('//localhost:', '//127.0.0.1:');
        const nodeAddresses = (node.addresses || []).map(normalizeAddr);

        // 1. Ghost of Self Protection
        if (node.nodeID !== this.localNodeID && nodeAddresses.length > 0) {
            const localNode = this.nodes.get(this.localNodeID);
            if (localNode && localNode.addresses && localNode.addresses.length > 0) {
                const localAddresses = localNode.addresses.map(normalizeAddr);
                const hasOverlap = nodeAddresses.some(addr => localAddresses.includes(addr));
                if (hasOverlap) {
                    this.logger.debug(`Ignoring ghost of self: ${node.nodeID} at ${node.addresses.join(', ')}`);
                    return;
                }
            }
        }

        // 2. Conflict Resolution (Node Rebirth)
        if (nodeAddresses.length > 0) {
            for (const [id, entry] of this.nodes.entries()) {
                if (id === node.nodeID) continue;
                if (entry.addresses && entry.addresses.length > 0) {
                    const entryAddresses = entry.addresses.map(normalizeAddr);
                    if (entryAddresses.some(addr => nodeAddresses.includes(addr))) {
                        this.logger.info(`Address conflict detected: ${node.nodeID} replacing stale ${id} at ${node.addresses.join(', ')}`);
                        this.nodes.delete(id);
                        if (this.dht) this.dht.removeNode(id);
                    }
                }
            }
        }

        // If node exists and seq is lower, ignore incoming (stale info)
        if (existing && (existing.nodeSeq ?? 0) > (node.nodeSeq ?? 0)) {
            return;
        }

        // If node exists and seq is same, DO NOT refresh timestamp.
        // Timestamp refresh should only happen via direct heartbeat() or seq update.
        // This prevents PEX (gossip) from keeping dead nodes alive indefinitely.
        if (existing && (existing.nodeSeq ?? 0) === (node.nodeSeq ?? 0)) {
            // Only update metadata/metrics if needed, but NOT the lease timestamp
            existing.available = node.available ?? existing.available;
            if (node.cpu !== undefined) existing.cpu = node.cpu;
            if (node.activeRequests !== undefined) existing.activeRequests = node.activeRequests;
            
            this.emit('changed', node.nodeID);
            return;
        }

        const registryNode: RegistryNodeInfo = {
            nodeID: node.nodeID,
            type: node.type,
            nodeType: node.nodeType,
            trustLevel: node.trustLevel || 'public',
            namespace: node.namespace || 'default',
            addresses: node.addresses,
            services: (node.services as unknown as RegistryServiceInfo[]),
            capabilities: (node.capabilities as Record<string, unknown>) || {},
            resources: (node.resources as Record<string, unknown>),
            metadata: node.metadata || {},
            nodeSeq: node.nodeSeq || 1,
            hostname: node.hostname || 'unknown',
            pid: node.pid || 0,
            timestamp: Date.now(),
            bootedAt: node.bootedAt || existing?.bootedAt || Date.now(),
            available: node.available ?? true,
            lastHeartbeatTime: node.lastHeartbeatTime,
            parentID: node.parentID,
            hidden: node.hidden,
            cpu: node.cpu,
            activeRequests: node.activeRequests,
            healthScore: node.healthScore
        };

        this.nodes.set(node.nodeID, registryNode);
        if (this.dht) this.dht.addNode(registryNode);

        this.emit('changed', node.nodeID);
        this.logger.debug(`Node ${node.nodeID} registered/updated`);
    }

    public registerLocalModule(module: IServiceModule): void {
        this.localModules.set(module.domain, module);

        const localNode = this.nodes.get(this.localNodeID);
        if (localNode) {
            const contracts = module.getContracts();
            const serviceInfo: RegistryServiceInfo = {
                name: module.domain,
                version: '1.0.0',
                tools: contracts.reduce((acc: Record<string, RegistryToolInfo>, contract: ToolContract) => {
                    const toolKeyStr = `${contract.domain}.${contract.action}`;
                    acc[toolKeyStr] = {
                        name: toolKeyStr,
                        description: contract.description,
                        visibility: 'public',
                        metadata: {
                            isCrud: contract.isCrud,
                            destructive: contract.destructive
                        },
                        params: zodToJsonSchema(contract.inputSchema) as Record<string, unknown>,
                        returns: zodToJsonSchema(contract.outputSchema) as Record<string, unknown>,
                        timeout: contract.timeout
                    };
                    return acc;
                }, {} as Record<string, RegistryToolInfo>),
                events: Array.from(module.getEventHandlers().keys()).reduce((acc: Record<string, any>, name: string) => {
                    acc[name] = { name };
                    return acc;
                }, {})
            };

            localNode.services = localNode.services || [];
            const idx = localNode.services.findIndex(s => s.name === module.domain);
            if (idx >= 0) localNode.services[idx] = serviceInfo;
            else localNode.services.push(serviceInfo);

            localNode.nodeSeq = (localNode.nodeSeq || 0) + 1;
            this.registerNode(localNode as unknown as CoreNodeInfo);
            this.emit('local:changed');
        }
    }

    public registerTool(contract: ToolContract): void {
        const key = toolKey(contract);
        this.tools.set(key, contract);
        this.emit('tool:registered', contract);
    }

    public getTool(key: string): ToolContract | undefined {
        return this.tools.get(key);
    }

    public getTools(): ToolContract[] {
        return Array.from(this.tools.values());
    }

    public getNodes(): CoreNodeInfo[] {
        return Array.from(this.nodes.values()) as unknown as CoreNodeInfo[];
    }

    public getAvailableNodes(): CoreNodeInfo[] {
        return Array.from(this.nodes.values()).filter(n => n.available) as unknown as CoreNodeInfo[];
    }

    public getNode(nodeID: string): CoreNodeInfo | undefined {
        const node = this.nodes.get(nodeID);
        return node ? (node as unknown as CoreNodeInfo) : undefined;
    }

    public getNextToolEndpoint(toolName: string): { nodeID: string; tool: RegistryToolInfo } | undefined {
        const candidates: { nodeID: string; tool: RegistryToolInfo }[] = [];

        for (const node of this.nodes.values()) {
            if (!node.available) continue;
            for (const svc of node.services || []) {
                if (!svc.tools) continue;

                let tool = svc.tools[toolName];
                if (!tool && toolName.includes('.')) {
                    const parts = toolName.split('.');
                    if (parts[0] === svc.name) {
                        tool = svc.tools[parts[1]];
                    }
                }

                if (tool) {
                    candidates.push({ nodeID: node.nodeID, tool });
                }
            }
        }

        if (candidates.length === 0) return undefined;

        if (this.preferLocal) {
            const local = candidates.find(c => c.nodeID === this.localNodeID);
            if (local) return local;
        }

        const candidateNodes = candidates.map(c => this.nodes.get(c.nodeID)).filter(n => !!n) as RegistryNodeInfo[];
        const selectedNode = this.balancer.select(candidateNodes, { toolName: toolName });

        if (!selectedNode) return undefined;

        for (const svc of selectedNode.services) {
            if (!svc.tools) continue;

            let tool = svc.tools[toolName];
            if (!tool && toolName.includes('.')) {
                const parts = toolName.split('.');
                if (parts[0] === svc.name) {
                    tool = svc.tools[parts[1]];
                }
            }

            if (tool) {
                return { nodeID: selectedNode.nodeID, tool };
            }
        }

        return undefined;
    }

    private pruneStaleNodes(ttlMs: number): void {
        const now = Date.now();
        let changed = false;

        for (const [nodeID, node] of this.nodes.entries()) {
            if (nodeID === this.localNodeID) continue;

            const age = now - (node.timestamp || 0);

            if (age > ttlMs * 2) {
                this.nodes.delete(nodeID);
                if (this.dht) this.dht.removeNode(nodeID);
                this.logger.info(`Pruned stale node: ${nodeID}`);
                changed = true;
            }
            else if (age > ttlMs && node.available) {
                this.logger.info(`Node offline (missed heartbeats): ${nodeID}`);
                node.available = false;
                changed = true;
            }
        }

        if (changed) this.emit('changed');
    }

    public getServiceNames(): string[] {
        const names = new Set<string>();
        for (const node of this.nodes.values()) {
            if (node.available) {
                for (const svc of node.services || []) {
                    names.add(svc.name);
                }
            }
        }
        return Array.from(names);
    }

    public setBalancer(balancer: BaseBalancer): void {
        this.balancer = balancer;
    }
}
