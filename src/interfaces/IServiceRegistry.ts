import type { NodeInfo, IServiceNode } from './IMeshNetwork.js';
import type { ToolContract } from './IToolContract.js';
import type { IServiceModule } from './IServiceModule.js';

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
    registerNode(node: NodeInfo): void;
    unregisterNode(nodeID: string): void;
    heartbeat(nodeID: string, data?: { cpu?: number; activeRequests?: number }): void;
    findNodesForTool(toolName: string): NodeInfo[];
    waitForTool(toolName: string, timeout?: number): Promise<void>;

    /** Selects a node for a given tool using internal load-balancing (e.g. DHT). */
    selectNode(toolName: string, context?: { toolName: string, params: Record<string, unknown> }): IServiceNode | undefined;

    /** Tool registration */
    registerTool(contract: ToolContract): void;
    getTool(key: string): ToolContract | undefined;
    getTools(): ToolContract[];

    /** Module registration */
    registerModule(module: IServiceModule): void;
    unregisterModule(domain: string): void;
    getModule(domain: string): IServiceModule | undefined;
    listModules(): IServiceModule[];

    /** Starts the registry operations (e.g. pruning, monitoring). */
    start(): Promise<void>;

    /** Stops the registry operations gracefully. */
    stop(): Promise<void>;
}
