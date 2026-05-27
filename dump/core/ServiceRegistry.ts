import { EventEmitter } from 'eventemitter3';
import type { NodeInfo as RegistryNodeInfo, ServiceInfo as RegistryServiceInfo, ActionInfo as RegistryActionInfo } from '../types/registry.schema';
import type { ILogger  } from '../types/registry.types';
import { BaseBalancer } from '../balancers/BaseBalancer';
import { RoundRobinBalancer } from '../balancers/RoundRobinBalancer';
import { KademliaRoutingTable } from './KademliaRoutingTable';
import type { IServiceRegistry, IServiceNode, NodeInfo as CoreNodeInfo, TimerHandle } from '../interfaces';
import type { IServiceModule } from '../services/ServiceModule';
import { SafeTimer } from '../interfaces';

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
 * ServiceRegistry — manages the collection of known nodes and their services.
 * Bridges the local Zod schemas with the core interface.
 */
export class ServiceRegistry extends EventEmitter implements IServiceRegistry {
    private nodes = new Map<string, RegistryNodeInfo>();
    private dht: KademliaRoutingTable | null = null;
    private balancer: BaseBalancer;
    private preferLocal: boolean;
    private localNodeID: string;
    private dhtEnabled: boolean;
    private pruningTimer?: TimerHandle;
    private metricsTimer?: TimerHandle;
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
            SafeTimer.unref(timer);

            const check = () => {
                if (isAvailable()) {
                    SafeTimer.clearTimeout(timer);
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
            SafeTimer.unref(timer);

            const check = () => {
                if (this.getAvailableNodes().length >= count) {
                    SafeTimer.clearTimeout(timer);
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
        SafeTimer.unref(this.pruningTimer);

        this.metricsTimer = setInterval(() => this.updateLocalMetrics(), 10000);
        SafeTimer.unref(this.metricsTimer);

        this.logger.info(`ServiceRegistry started for node ${this.localNodeID}`);
    }

    public async stop(): Promise<void> {
        if (this.pruningTimer) {
            SafeTimer.clearInterval(this.pruningTimer);
            this.pruningTimer = undefined;
        }
        if (this.metricsTimer) {
            SafeTimer.clearInterval(this.metricsTimer);
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

    public findNodesForAction(actionName: string): CoreNodeInfo[] {
        const results: RegistryNodeInfo[] = [];
        for (const node of this.nodes.values()) {
            if (!node.available) continue;
            for (const svc of node.services) {
                if (!svc.actions) continue;
                
                let action = svc.actions[actionName];
                if (!action && actionName.includes(':')) {
                    // Just in case it was stored as localName
                    const parts = actionName.split(':');
                    if (parts[0] === svc.name) {
                        action = svc.actions[parts[1]];
                    }
                }

                if (action) {
                    results.push(node);
                    break;
                }
            }
        }
        return results as unknown as CoreNodeInfo[];
    }

    public selectNode(actionName: string, _context?: { action: string, params: Record<string, unknown> }): IServiceNode | undefined {
        const endpoint = this.getNextActionEndpoint(actionName);
        if (!endpoint) return undefined;
        
        const node = this.nodes.get(endpoint.nodeID);
        if (!node) return undefined;

        return {
            nodeID: node.nodeID,
            services: node.services.map(s => s.name),
            metadata: node.metadata
        };
    }

    registerNode(node: CoreNodeInfo): void {
        const existing = this.nodes.get(node.nodeID);
        if (existing && (existing.nodeSeq ?? 0) > (node.nodeSeq ?? 0)) {
            return;
        }

        if (existing && (existing.nodeSeq ?? 0) === (node.nodeSeq ?? 0)) {
            existing.timestamp = Date.now();
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

    registerLocalModule(module: IServiceModule): void {
        this.localModules.set(module.domain, module);
        
        const localNode = this.nodes.get(this.localNodeID);
        if (localNode) {
            const contracts = module.getContracts();
            const serviceInfo: RegistryServiceInfo = {
                name: module.domain,
                version: '1.0.0',
                actions: contracts.reduce((acc, contract) => {
                    // Storing fully qualified tool key domain:action
                    const actionKey = `${contract.domain}:${contract.action}`;
                    acc[actionKey] = {
                        name: actionKey,
                        visibility: 'public',
                        metadata: {
                            description: contract.description,
                            isCrud: contract.isCrud,
                            destructive: contract.destructive
                        }
                    };
                    return acc;
                }, {} as Record<string, RegistryActionInfo>)
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

    getNodes(): CoreNodeInfo[] {
        return Array.from(this.nodes.values()) as unknown as CoreNodeInfo[];
    }

    getAvailableNodes(): CoreNodeInfo[] {
        return Array.from(this.nodes.values()).filter(n => n.available) as unknown as CoreNodeInfo[];
    }

    getNode(nodeID: string): CoreNodeInfo | undefined {
        const node = this.nodes.get(nodeID);
        return node ? (node as unknown as CoreNodeInfo) : undefined;
    }

    getNextActionEndpoint(actionName: string): { nodeID: string; action: RegistryActionInfo } | undefined {
        const candidates: { nodeID: string; action: RegistryActionInfo }[] = [];

        for (const node of this.nodes.values()) {
            if (!node.available) continue;
            for (const svc of node.services || []) {
                if (!svc.actions) continue;
                
                let action = svc.actions[actionName];
                if (!action && actionName.includes(':')) {
                    const parts = actionName.split(':');
                    if (parts[0] === svc.name) {
                        action = svc.actions[parts[1]];
                    }
                }

                if (action) {
                    candidates.push({ nodeID: node.nodeID, action });
                }
            }
        }

        if (candidates.length === 0) return undefined;

        if (this.preferLocal) {
            const local = candidates.find(c => c.nodeID === this.localNodeID);
            if (local) return local;
        }

        const candidateNodes = candidates.map(c => this.nodes.get(c.nodeID)).filter(n => !!n) as RegistryNodeInfo[];
        const selectedNode = this.balancer.select(candidateNodes, { action: actionName });
        
        if (!selectedNode) return undefined;

        for (const svc of selectedNode.services) {
            if (!svc.actions) continue;
            
            let action = svc.actions[actionName];
            if (!action && actionName.includes(':')) {
                const parts = actionName.split(':');
                if (parts[0] === svc.name) {
                    action = svc.actions[parts[1]];
                }
            }

            if (action) {
                return { nodeID: selectedNode.nodeID, action };
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

            if (age > ttlMs) {
                this.nodes.delete(nodeID);
                if (this.dht) this.dht.removeNode(nodeID);
                this.logger.info(`Pruned stale node: ${nodeID}`);
                changed = true;
            } 
            else if (age > 10000 && node.available) {
                this.logger.info(`Node offline (missed heartbeats): ${nodeID}`);
                node.available = false;
                changed = true;
            }
        }

        if (changed) this.emit('changed');
    }

    getServiceNames(): string[] {
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

    setBalancer(balancer: BaseBalancer): void {
        this.balancer = balancer;
    }
}
