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

// Platform-agnostic hostname, resolved once.
//
// This used to be `eval('require')('os')` in a try/catch falling back to
// 'browser-client'. That fallback was meant for browsers and fired in Node too:
// every package here is ESM ("type": "module"), and an ESM module has no
// `require`, so the eval threw and *every Node process reported itself as
// 'browser-client'*. The check has to be "am I in Node", not "does require
// exist" -- those stopped being the same question when the framework moved to ESM.
//
// Populated asynchronously because `import()` is the only ESM-safe way to reach
// node:os without making this module unloadable in a browser bundle. The local
// node record is built in the constructor, which can run before that import
// settles -- so callers register for the value instead of reading it once and
// caching a placeholder forever.
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

/** Calls back once the real hostname is known -- immediately if it already is. */
const onHostnameResolved = (callback: (hostname: string) => void): void => {
    if (resolvedHostname !== undefined) callback(resolvedHostname);
    else if (isNodeRuntime()) hostnameWaiters.push(callback);
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

        // Initialize local node entry
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
            // Same reasoning as PlacementRegistry's own copy of this constructor: nothing else writes
            // this field, and the self-mutating registerContract/unregisterContract/unregisterDomain
            // path preserves whatever is set here across every later presence update.
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

        // node:os resolves on a later tick than this constructor, so patch the
        // record once it lands rather than shipping the placeholder to every peer.
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
                // Names who it *did* see, because the count alone sends you looking at the wrong
                // thing. Seeing only yourself after connecting successfully means the peer never
                // answered -- most often because another live process already holds this nodeID
                // there, which that node logs and refuses (WSTransport's DUPLICATE_NODE_ID_CLOSE).
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
        this.pruningTimer = setInterval(() => this.pruneStaleNodes(this.ttl), this.pruneInterval);
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


    /**
     * Advertises one contract, merging it into this node's presence under its own domain.
     *
     * Without this, a broker that mounts contracts directly -- which is now how everything is
     * mounted -- would answer them locally while every peer was told "no node advertises domain
     * X". That failure is silent and looks like a routing problem: the contract is registered, the
     * schema is known, and the call simply cannot be placed. It was found live, and was the reason
     * `PlacementRegistry` existed as the only registry that could do this.
     *
     * The two implementations are now the same in this respect. What still separates them is how
     * they *route*, not what they can advertise.
     */
    public registerContract(contract: ToolContract): void {
        this.registerTool(contract);

        const localNode = this.nodes.get(this.localNodeID);
        if (!localNode) return;

        const key = `${contract.domain}.${contract.action}`;
        const toolInfo: RegistryToolInfo = {
            name: key,
            description: contract.description,
            visibility: 'public',
            metadata: { isCrud: contract.isCrud, destructive: contract.destructive },
            params: zodToJsonSchema(contract.inputSchema) as Record<string, unknown>,
            returns: zodToJsonSchema(contract.outputSchema) as Record<string, unknown>,
            timeout: contract.timeout,
        };

        localNode.services = localNode.services || [];
        const existing = localNode.services.findIndex((s) => s.name === contract.domain);
        if (existing >= 0) {
            localNode.services[existing]!.tools = { ...localNode.services[existing]!.tools, [key]: toolInfo };
        } else {
            localNode.services.push({ name: contract.domain, version: '1.0.0', tools: { [key]: toolInfo }, events: {} });
        }

        localNode.nodeSeq = (localNode.nodeSeq || 0) + 1;
        this.registerNode(localNode as unknown as CoreNodeInfo);
        this.emit('local:changed');
    }

    /**
     * Withdraws one contract, leaving every sibling under the same domain advertised. A domain
     * whose last contract goes is removed entirely, so presence never claims an empty service.
     */
    public unregisterContract(toolKeyStr: string): void {
        this.tools.delete(toolKeyStr);

        const localNode = this.nodes.get(this.localNodeID);
        if (!localNode?.services) return;

        for (const service of localNode.services) {
            const tools = service.tools ?? {};
            if (tools[toolKeyStr] === undefined) continue;
            const { [toolKeyStr]: _removed, ...rest } = tools;
            service.tools = rest;
        }
        localNode.services = localNode.services.filter((s) => Object.keys(s.tools ?? {}).length > 0);

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

            // A heartbeat is proof of life, so it must be able to bring a node
            // back. pruneStaleNodes flips `available` to false once the lease
            // lapses, and nothing else ever flipped it back -- so a node that
            // went quiet for 30s stayed unusable to getNextToolEndpoint even
            // while it was actively talking to us again.
            if (!node.available) {
                node.available = true;
                this.emit('changed', nodeID);
            }
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
            // Packet-layer namespace filtering (MeshNetwork) already keeps foreign-namespace
            // nodes out of `this.nodes` via presence/PEX -- this is defense-in-depth so routing
            // stays correct even if a node ever enters the map through some other path.
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

    public registerNode(node: CoreNodeInfo, trusted = false): void {
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

        // `bootedAt` is a real generation marker (set once, at process start, never recomputed) --
        // unlike nodeSeq, which is not a boot generation, it is just how many contracts a node has
        // registered so far in its *current* process, and resets low on every restart. When both
        // sides have one and they disagree, that alone settles which record is newer: a later
        // `bootedAt` is always a later boot, full stop, regardless of trusted or nodeSeq. An earlier
        // `bootedAt` than what's on record is unambiguously a stale packet describing a boot we've
        // already moved past -- refused outright, even if trusted (a live connection should never
        // report an older bootedAt than what it already told us). This is what actually closes the
        // gap `trusted` alone left open: a relay caching a peer's *previous* boot (higher nodeSeq,
        // because that boot ran longer and registered more contracts) arriving *after* that peer's
        // own genuine post-restart presence would still win on nodeSeq alone -- bootedAt can't be
        // fooled the same way, because it doesn't grow with contract count, only with real time.
        if (existing?.bootedAt !== undefined && node.bootedAt !== undefined && existing.bootedAt !== node.bootedAt) {
            if (node.bootedAt < existing.bootedAt) return;
            // else: a genuinely newer boot -- fall through to the full replace below, bypassing
            // nodeSeq entirely (a fresh process legitimately starts back at a low nodeSeq).
        } else {
            // Same boot (or one side predates this field) -- nodeSeq is the only signal available,
            // same as before.
            //
            // If node exists and seq is lower, ignore incoming (stale info) -- unless this is the
            // node speaking for itself right now (trusted, set only by handlePresence, never by
            // PEX). A relay still holding this node's nodeSeq from a previous, longer-lived boot
            // would otherwise permanently outrank every real update from a freshly-restarted node --
            // not just metadata, anything -- because this guard returns before any later logic runs.
            // Found live: a spoke reconnecting to the hub still showed {} for its own --labels no
            // matter how many times it reconnected, because a stale PEX relay of it, from before its
            // restart, had already won this comparison. A trusted call skips straight to the full
            // replace below, which also resets nodeSeq to this node's real current value for every
            // future comparison.
            if (!trusted && existing && (existing.nodeSeq ?? 0) > (node.nodeSeq ?? 0)) {
                return;
            }

            // If node exists and seq is same, DO NOT refresh timestamp.
            // Timestamp refresh should only happen via direct heartbeat() or seq update.
            // This prevents PEX (gossip) from keeping dead nodes alive indefinitely.
            if (!trusted && existing && (existing.nodeSeq ?? 0) === (node.nodeSeq ?? 0)) {
                // Only update metadata/metrics if needed, but NOT the lease timestamp
                existing.available = node.available ?? existing.available;
                if (node.cpu !== undefined) existing.cpu = node.cpu;
                if (node.activeRequests !== undefined) existing.activeRequests = node.activeRequests;
                // A node's --labels never change after boot, so there is no staleness risk in taking
                // them whenever a packet actually has them -- only in refusing to. Without this, a
                // registration that reaches us first with no metadata (an intermediary relaying its
                // own stale, pre-fix copy of a peer's labels, or simply racing a peer's own direct
                // presence on reconnect) locks that peer's labels at {} forever: this same-nodeSeq
                // path is the only one every later packet for that nodeSeq takes, and it never used
                // to touch metadata at all. Found live, after the PEX metadata fix (v4.2.2): two
                // nodes that reconnected to a third at the same moment still raced into this path.
                if (node.metadata && Object.keys(node.metadata).length > 0) existing.metadata = node.metadata;

                this.emit('changed', node.nodeID);
                return;
            }
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

    /**
     * Deterministic, not elected: every node computes this the same way from the same registry
     * state it already maintains (heartbeat/presence, the same data getNextToolEndpoint already
     * scans) -- no vote, no extra round trip, no new protocol chatter. Among the nodes currently
     * running `domain`, the leader is whichever one's nodeID is closest, by the same XOR distance
     * KademliaRoutingTable uses for peer routing, to hash(domain). If the current leader
     * disappears (pruneStaleNodes ages it out the same as any other dead node), every node's next
     * call to this function picks someone else automatically -- fault tolerance falls out of it
     * being a pure function over already-converging state, not out of anything failover-specific.
     *
     * This does not itself make anything safe to run on more than one node at once -- it only
     * answers "which one node should." A caller still has to actually route the sensitive
     * operation to that node (or refuse to run it locally when it isn't the leader) for the
     * guarantee to mean anything.
     */
    /**
     * XOR-closest over *every* available node, not only those already serving `key` -- see
     * `IServiceRegistry.placementFor`. Same rule as `leaderFor`, different candidate set, which is
     * the whole distinction between routing to something and deciding where to put it.
     */
    public placementFor(key: string): CoreNodeInfo | undefined {
        const candidates: RegistryNodeInfo[] = [];
        for (const node of this.nodes.values()) {
            if (!node.available) continue;
            if ((node.namespace || 'default') !== this.localNamespace) continue;
            candidates.push(node);
        }

        return Registry.closestTo(key, candidates);
    }

    /** The shared half of leaderFor/placementFor: closest node id to `key` by XOR distance. */
    private static closestTo(key: string, candidates: RegistryNodeInfo[]): CoreNodeInfo | undefined {
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

    public leaderFor(domain: string): CoreNodeInfo | undefined {
        const candidates: RegistryNodeInfo[] = [];
        for (const node of this.nodes.values()) {
            if (!node.available) continue;
            if ((node.namespace || 'default') !== this.localNamespace) continue;
            if (node.services.some((svc) => svc.name === domain)) {
                candidates.push(node);
            }
        }
        if (candidates.length === 0) return undefined;

        const targetID = idToBigInt(domain);
        let closest = candidates[0]!;
        let closestDistance = xorDistance(targetID, idToBigInt(closest.nodeID));
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
