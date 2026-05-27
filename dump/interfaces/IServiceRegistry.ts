import type { IServiceModule  } from '../services/ServiceModule';

export interface ServiceDetails {
    name: string;
    fullName?: string;
    version?: string | number;
    actions?: Record<string, { name?: string; visibility?: string }>;
    metadata?: Record<string, unknown>;
}

export interface NodeResources {
    cpu?: number;
    memory?: {
        total: number;
        free: number;
        used: number;
    };
    storage?: Record<string, unknown>;
    [key: string]: unknown;
}

export interface NodeCapabilities {
    transports?: string[];
    features?: string[];
    [key: string]: unknown;
}

/**
 * Service Node Discovery Metadata
 */
export interface IServiceNode {
    nodeID: string;
    services: string[];
    metadata?: Record<string, unknown>;
}

export interface NodeInfo {
    nodeID: string;
    hostname?: string;
    type: string;
    nodeType?: string;
    namespace: string;
    addresses: string[];
    trustLevel?: 'internal' | 'user' | 'public';
    available?: boolean;
    timestamp?: number;
    capabilities?: NodeCapabilities;
    resources?: NodeResources;
    nodeSeq?: number;
    services: ServiceDetails[]; // Avoid circular dependency with full ServiceInfo
    pid?: number;
    parentID?: string;
    hidden?: boolean;
    metadata?: Record<string, unknown>;
    cpu?: number;
    activeRequests?: number;
    healthScore?: number;
    lastHeartbeatTime?: number;
    publicKey?: string;
}

/**
 * IServiceRegistry — Interface for service discovery and tracking.
 */
export interface IServiceRegistry {
    on(event: string, handler: (...args: unknown[]) => void): void;
    off(event: string, handler: (...args: unknown[]) => void): void;
    emit(event: string, ...args: unknown[]): void;

    registerModule(module: IServiceModule): void;
    unregisterModule(domain: string): void;
    getModule(domain: string): IServiceModule | undefined;
    listModules(): IServiceModule[];

    waitForService(serviceName: string, timeout?: number): Promise<void>;
    waitForNodes(count: number, timeout?: number): Promise<void>;

    /** Node-level discovery */
    getNode(nodeID: string): NodeInfo | undefined;
    getNodes(): NodeInfo[];
    getAvailableNodes(): NodeInfo[];
    registerNode(node: NodeInfo): void;
    unregisterNode(nodeID: string): void;
    heartbeat(nodeID: string, data?: { cpu?: number; activeRequests?: number }): void;
    findNodesForAction(actionName: string): NodeInfo[];

    /** Selects a node for a given action using internal load-balancing (e.g. DHT). */
    selectNode(actionName: string, context?: { action: string, params: Record<string, unknown> }): IServiceNode | undefined;

    /** Starts the registry operations (e.g. pruning, monitoring). */
    start(): Promise<void>;

    /** Stops the registry operations gracefully. */
    stop(): Promise<void>;
}
