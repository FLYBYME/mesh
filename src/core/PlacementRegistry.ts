import { EventEmitter } from 'eventemitter3';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { NodeInfo as RegistryNodeInfo, ServiceInfo as RegistryServiceInfo, ToolInfo as RegistryToolInfo } from '../types/registry.schema.js';
import type { ILogger } from '../interfaces/ILogger.js';
import { BaseBalancer } from '../balancers/BaseBalancer.js';
import { RoundRobinBalancer } from '../balancers/RoundRobinBalancer.js';
import { KademliaRoutingTable, idToBigInt, xorDistance } from './KademliaRoutingTable.js';
import type { IServiceRegistry } from '../interfaces/IServiceRegistry.js';
import type { NodeInfo as CoreNodeInfo, IServiceNode } from '../interfaces/IMeshNetwork.js';
import { ToolContract, toolKey } from '../interfaces/IToolContract.js';

// Platform-agnostic hostname resolution -- identical to Registry.ts's own; see that file's comment
// for why this can't just be `eval('require')('os')`.
let resolvedHostname: string | undefined;
const hostnameWaiters: Array<(hostname: string) => void> = [];

const isNodeRuntime = (): boolean => {
    const proc = (globalThis as { process?: { versions?: { node?: string } } }).process;
    return typeof proc?.versions?.node === 'string';
};

const setResolvedHostname = (hostname: string): void => {
    resolvedHostname = hostname;
    while (hostnameWaiters.length > 0) {
        const waiter = hostnameWaiters.shift();
        if (waiter) waiter(hostname);
    }
};

if (isNodeRuntime()) {
    import('node:os')
        .then((os) => setResolvedHostname(os.hostname()))
        .catch(() => setResolvedHostname('unknown-node'));
}

const getHostname = (): string => {
    if (!isNodeRuntime()) return 'browser-client';
    return resolvedHostname ?? 'unknown-node';
};

const onHostnameResolved = (callback: (hostname: string) => void): void => {
    if (resolvedHostname !== undefined) callback(resolvedHostname);
    else if (isNodeRuntime()) hostnameWaiters.push(callback);
};

/**
 * PlacementRegistry: a second, independent `IServiceRegistry` implementation, swappable for
 * `Registry` (same interface, same constructor shape) rather than a patch to it.
 *
 * Everything that actually *routes* on this node's advertised presence data --
 * `findNodesForTool`, `getNextToolEndpoint`, `selectNode`, `leaderFor`, pruning, heartbeat, the
 * DHT -- is agnostic to how that presence got built, and is copied here unchanged from `Registry`.
 *
 * What's different: `registerContract(contract)` is the only registration path -- one contract, no
 * module wrapper, matching "every contract stands alone" (docs/CONTRACT_DRIVEN_PLACEMENT.md,
 * "`ServiceModule` is dropped"). A domain's presence entry is assembled contract by contract, and
 * `unregisterDomain(domain)` takes the whole thing back down.
 *
 * Kept fully separate from `Registry.ts` -- not a subclass, not a shared base -- so nothing here can
 * ever regress the existing, working implementation. Swap it in via whatever constructs the
 * registry (`RegistryModule`) once it's proven; `Registry` is untouched either way.
 */
export class PlacementRegistry extends EventEmitter implements IServiceRegistry {
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
    private pruneInterval: number;

    private localNamespace: string;

    constructor(
        private logger: ILogger,
        options: { preferLocal?: boolean; localNodeID?: string; dhtEnabled?: boolean; ttl?: number; pruneInterval?: number; namespace?: string; metadata?: Record<string, string> } = {}
    ) {
        super();
        this.preferLocal = options.preferLocal ?? true;
        this.localNodeID = options.localNodeID || `node_${Math.random().toString(36).substr(2, 9)}`;
        this.dhtEnabled = options.dhtEnabled ?? false;
        this.ttl = options.ttl || 30000;
        this.pruneInterval = options.pruneInterval ?? Math.min(5000, Math.max(100, Math.floor(this.ttl / 2)));
        this.localNamespace = options.namespace || 'default';
        this.balancer = new RoundRobinBalancer();

        if (this.dhtEnabled) {
            this.dht = new KademliaRoutingTable(this.localNodeID);
        }

        this.registerNode({
            nodeID: this.localNodeID,
            type: 'node',
            namespace: this.localNamespace,
            addresses: [],
            available: true,
            timestamp: Date.now(),
            bootedAt: Date.now(),
            nodeSeq: 1,
            hostname: getHostname(),
            services: [],
            trustLevel: 'internal',
            // An operator-declared label set (mesh-serve's `--labels role=dns`), carried verbatim in
            // every presence broadcast (broadcastPresence sends this whole node record) since nothing
            // else writes this field -- see registerContract/unregisterContract/unregisterDomain,
            // which mutate this same object in place and re-register it, so a value set here survives
            // every later change to what this node advertises.
            metadata: options.metadata ?? {},
            capabilities: {
                transports: ['ws'],
                features: ['relay']
            },
            pid: typeof process !== 'undefined' ? process.pid : 0,
            cpu: 0,
            activeRequests: 0,
            healthScore: 1.0
        });

        onHostnameResolved((hostname) => {
            const local = this.nodes.get(this.localNodeID);
            if (local) local.hostname = hostname;
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
                // Same message as Registry's -- see the reasoning there.
                const seen = this.getAvailableNodes().map((node) => node.nodeID);
                reject(new Error(
                    `Timeout: only ${seen.length}/${count} nodes found (this node is "${this.localNodeID}"; saw: ${seen.join(', ')})`,
                ));
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
                this.logger.info('PlacementRegistry state on timeout:', this);
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
        this.pruningTimer = setInterval(() => this.pruneStaleNodes(this.ttl), this.pruneInterval);
        if (this.pruningTimer.unref) this.pruningTimer.unref();

        this.metricsTimer = setInterval(() => this.updateLocalMetrics(), 10000);
        if (this.metricsTimer.unref) this.metricsTimer.unref();

        this.logger.info(`PlacementRegistry started for node ${this.localNodeID}`);
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

                const cpus = os.cpus();
                if (cpus && cpus.length > 0) {
                    const loadAvg = os.loadavg();
                    const cpuUsage = (loadAvg[0] / cpus.length) * 100;
                    localNode.cpu = Math.round(Math.min(Math.max(cpuUsage, 0), 100));
                }

                const totalMem = os.totalmem();
                if (totalMem > 0) {
                    const ramUsage = (process.memoryUsage().rss / totalMem) * 100;
                    localNode.activeRequests = Math.round(ramUsage * 100);
                }
            } else {
                localNode.cpu = Math.round(Math.random() * 20);
                localNode.activeRequests = Math.round(Math.random() * 40 * 100);
            }

            localNode.timestamp = Date.now();
            this.emit('local:changed');
        } catch {
            // Ignore if 'os' is not resolvable
        }
    }

    /**
     * The native registration path: one contract, no module required. Merges into the domain's
     * `ServiceInfo.tools` the same way multiple modules sharing one domain already merge in
     * `Registry.ts` (several standalone contracts sharing a domain is now the *normal* case, not an
     * edge case) -- never replaces a domain's existing entry outright.
     */
    public registerContract(contract: ToolContract): void {
        this.registerTool(contract);

        const localNode = this.nodes.get(this.localNodeID);
        if (!localNode) return;

        const key = toolKey(contract);
        const toolInfo: RegistryToolInfo = {
            name: key,
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

        localNode.services = localNode.services || [];
        const idx = localNode.services.findIndex(s => s.name === contract.domain);
        if (idx >= 0) {
            localNode.services[idx].tools = { ...localNode.services[idx].tools, [key]: toolInfo };
        } else {
            localNode.services.push({
                name: contract.domain,
                version: '1.0.0',
                tools: { [key]: toolInfo },
                events: {}
            });
        }

        localNode.nodeSeq = (localNode.nodeSeq || 0) + 1;
        this.registerNode(localNode as unknown as CoreNodeInfo);
        this.emit('local:changed');
    }

    /** `registerContract`'s other half -- removes one contract's presence without disturbing any
     *  sibling contract still advertised under the same domain. */
    public unregisterContract(key: string): void {
        this.tools.delete(key);

        const localNode = this.nodes.get(this.localNodeID);
        if (!localNode) return;

        const domain = key.substring(0, key.lastIndexOf('.'));
        const idx = localNode.services.findIndex(s => s.name === domain);
        if (idx < 0) return;

        const { [key]: _removed, ...rest } = localNode.services[idx].tools ?? {};
        localNode.services[idx].tools = rest;

        localNode.nodeSeq = (localNode.nodeSeq || 0) + 1;
        this.registerNode(localNode as unknown as CoreNodeInfo);
        this.emit('local:changed');
    }

    /** Withdraws every contract of a domain at once -- the counterpart to unloading a whole part. */
    public unregisterDomain(domain: string): void {
        const localNode = this.nodes.get(this.localNodeID);
        if (!localNode) return;

        for (const service of localNode.services) {
            if (service.name !== domain) continue;
            for (const key of Object.keys(service.tools ?? {})) this.tools.delete(key);
        }
        localNode.services = localNode.services.filter((s) => s.name !== domain);
        localNode.nodeSeq++;
        this.registerNode(localNode as unknown as CoreNodeInfo);
        this.emit('local:changed');
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

            if (!node.available) {
                node.available = true;
                this.emit('changed', nodeID);
            }
            if (data) {
                if (data.cpu !== undefined) node.cpu = data.cpu;
                if (data.activeRequests !== undefined) node.activeRequests = data.activeRequests;
            }

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
            if ((node.namespace || 'default') !== this.localNamespace) continue;
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

        const normalizeAddr = (addr: string) => addr.replace('//localhost:', '//127.0.0.1:');
        const nodeAddresses = (node.addresses || []).map(normalizeAddr);

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

        if (existing && (existing.nodeSeq ?? 0) > (node.nodeSeq ?? 0)) {
            return;
        }

        if (existing && (existing.nodeSeq ?? 0) === (node.nodeSeq ?? 0)) {
            existing.available = node.available ?? existing.available;
            if (node.cpu !== undefined) existing.cpu = node.cpu;
            if (node.activeRequests !== undefined) existing.activeRequests = node.activeRequests;
            // A node's --labels never change after boot, so there is no staleness risk in taking
            // them whenever a packet actually has them -- only in refusing to. Without this, a
            // registration that reaches us first with no metadata (an intermediary relaying its own
            // stale, pre-fix copy of a peer's labels, or simply racing a peer's own direct presence
            // on reconnect) locks that peer's labels at {} forever: this same-nodeSeq path is the
            // only one every later packet for that nodeSeq takes, and it never used to touch
            // metadata at all. Found live, after the PEX metadata fix (v4.2.2): two nodes that
            // reconnected to a third at the same moment still raced each other into this path.
            if (node.metadata && Object.keys(node.metadata).length > 0) existing.metadata = node.metadata;

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
            if ((node.namespace || 'default') !== this.localNamespace) continue;
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

    /** Identical semantics to `Registry.leaderFor` -- see that file's own comment. */
    public leaderFor(domain: string): CoreNodeInfo | undefined {
        return this.closestTo(domain, (node) => node.services.some((svc) => svc.name === domain));
    }

    /** Identical semantics to `Registry.placementFor` -- every available node is a candidate. */
    public placementFor(key: string): CoreNodeInfo | undefined {
        return this.closestTo(key, () => true);
    }

    /**
     * The shared half: closest available node id to `key` by XOR distance, among those the filter
     * accepts. The filter is the only difference between routing to something that exists and
     * choosing where to put something that does not.
     */
    private closestTo(key: string, accept: (node: RegistryNodeInfo) => boolean): CoreNodeInfo | undefined {
        const candidates: RegistryNodeInfo[] = [];
        for (const node of this.nodes.values()) {
            if (!node.available) continue;
            if ((node.namespace || 'default') !== this.localNamespace) continue;
            if (accept(node)) candidates.push(node);
        }

        const first = candidates[0];
        if (first === undefined) return undefined;

        const targetID = idToBigInt(key);
        let closest = first;
        let closestDistance = xorDistance(targetID, idToBigInt(first.nodeID));
        for (const candidate of candidates.slice(1)) {
            const distance = xorDistance(targetID, idToBigInt(candidate.nodeID));
            if (distance < closestDistance) {
                closest = candidate;
                closestDistance = distance;
            }
        }

        return closest as unknown as CoreNodeInfo;
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
