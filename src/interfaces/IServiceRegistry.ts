import type { NodeInfo, IServiceNode, ToolInfo } from './IMeshNetwork.js';
import type { ToolContract } from './IToolContract.js';

/**
 * IServiceRegistry — Interface for service discovery and tracking.
 */
export interface IServiceRegistry {
    on(event: string, handler: (...args: unknown[]) => void): void;
    off(event: string, handler: (...args: unknown[]) => void): void;
    emit(event: string, ...args: unknown[]): void;

    waitForService(serviceName: string, timeout?: number): Promise<void>;
    waitForNodes(count: number, timeout?: number): Promise<void>;

    /** Node-level discovery */
    getNode(nodeID: string): NodeInfo | undefined;
    getNodes(): NodeInfo[];
    getAvailableNodes(): NodeInfo[];
    /**
     * `trusted`: the node speaking for itself, first-hand (handlePresence) -- always wins over
     * whatever nodeSeq a stale relay (PEX) may still be holding for it. Never set by PEX itself.
     */
    registerNode(node: NodeInfo, trusted?: boolean): void;
    /**
     * Replaces this node's own labels while it runs (how a machine is given a role through the
     * api), bumping nodeSeq so peers take the change and a stale relay cannot revert it.
     */
    setLocalMetadata(metadata: Record<string, string>): void;
    unregisterNode(nodeID: string): void;
    heartbeat(nodeID: string, data?: { cpu?: number; activeRequests?: number }): void;
    findNodesForTool(toolName: string): NodeInfo[];
    waitForTool(toolName: string, timeout?: number): Promise<void>;

    /** Selects a node for a given tool using internal load-balancing (e.g. DHT). */
    selectNode(toolName: string, context?: { toolName: string, params: Record<string, unknown> }): IServiceNode | undefined;
    
    getNextToolEndpoint(toolName: string): { nodeID: string; tool: ToolInfo } | undefined;

    /**
     * Deterministic single-node assignment for a domain -- every node computes the same answer
     * from the same presence data (no election, no extra messages), and it changes automatically
     * as nodes join/leave. Answers "which one node should handle this," not itself a guarantee
     * anything is safe -- a caller has to actually route to (or defer to) that node for the
     * guarantee to hold.
     */
    leaderFor(domain: string): NodeInfo | undefined;

    /**
     * Deterministic assignment for something **not running yet** -- "which node should host this",
     * where `leaderFor` answers "which of the nodes already serving it should lead".
     *
     * The difference is the candidate set, and it matters: `leaderFor` only considers nodes that
     * already advertise the domain, so for a service nobody is running it correctly answers
     * `undefined` -- which is useless to a supervisor whose whole job is placing exactly that.
     * This picks from every available node in the namespace, by the same XOR-closest rule, so
     * every node agrees without an election and the answer moves on its own when membership
     * changes.
     *
     * `key` is any stable string -- a domain, a part key, whatever identifies the thing being
     * placed. Undefined only when the namespace has no available nodes at all.
     */
    placementFor(key: string): NodeInfo | undefined;

    /** Tool registration */
    registerTool(contract: ToolContract): void;
    getTool(key: string): ToolContract | undefined;
    getTools(): ToolContract[];

    /**
     * Advertises one locally-mounted contract in this node's presence data -- the only
     * registration path there is now that `ServiceModule` is gone. A domain's presence entry is
     * assembled contract by contract; `unregisterContract` takes one back out, and
     * `unregisterDomain` removes the whole entry at once (part eviction).
     */
    registerContract(contract: ToolContract): void;
    unregisterContract(toolKey: string): void;
    unregisterDomain(domain: string): void;

    /** Starts the registry operations (e.g. pruning, monitoring). */
    start(): Promise<void>;

    /** Stops the registry operations gracefully. */
    stop(): Promise<void>;
}
