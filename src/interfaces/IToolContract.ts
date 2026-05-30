import { z } from "zod";

// ─── HTTP Method Types ───────────────────────────────────────────────────────

/**
 * HttpMethod: Supported REST methods for tool contracts.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

// ─── REST Route Metadata ─────────────────────────────────────────────────────

/**
 * RestMeta: Describes how a tool maps to a REST endpoint.
 */
export interface RestMeta {
    /** HTTP method */
    readonly method: HttpMethod;
    /** URL path pattern with :param placeholders */
    readonly path: string;
    /** Whether this tool returns an event stream (SSE) */
    readonly isStream?: boolean;
}

// ─── Tool Contract ───────────────────────────────────────────────────────────

/**
 * ToolContract: The shared, declarative interface that defines a single tool.
 * This is the source of truth consumed by:
 *   - Server (auto-route registration)
 *   - SDK (generated client methods)
 *   - AI Agents (MCP/LLM tool definitions)
 *
 * TInput and TOutput are Zod schemas that define the tool's interface.
 */
export interface ToolContract<
    TInput extends z.ZodTypeAny = z.ZodTypeAny,
    TOutput extends z.ZodTypeAny = z.ZodTypeAny,
    TPrint = z.infer<TOutput>
> {
    /** Domain namespace, e.g. 'agent', 'entity', 'combat'. MUST NOT contain underscores. */
    readonly domain: string;
    /** Action name, e.g. 'list', 'get', 'fire'. MUST NOT contain underscores. */
    readonly action: string;
    /** Human-readable description for docs and AI agents */
    readonly description: string;
    /** Zod schema for validated input */
    readonly inputSchema: TInput;
    /** Zod schema for validated output */
    readonly outputSchema: TOutput;
    /** REST endpoint mapping */
    readonly rest: RestMeta;
    /** Whether this tool is destructive (modifies state or performs high-risk actions) */
    readonly destructive?: boolean;
    /** Whether this tool is a CRUD operation */
    readonly isCrud?: boolean;
    /** Whether this tool is a Time Series operation */
    readonly isTimeSeries?: boolean;
    /** Optional event flag: true to dispatch default domain.action, or string to override action name */
    readonly event?: boolean | string;
    /** Optional custom RPC timeout in milliseconds */
    readonly timeout?: number;
    /** Formats the tool output as a human-readable string */
    readonly print: (output: TPrint) => string;
}

/**
 * defaultPrint: A robust, shared helper to format tool output for AI agents.
 * Ensures that agents receive full JSON context rather than summarized strings.
 */
export const defaultPrint = (output: unknown): string => {
    return typeof output === 'string' ? output : JSON.stringify(output, null, 2);
};

// ─── Tool Key Generation ─────────────────────────────────────────────────────

/**
 * toolKey: Generates a canonical tool key from domain and action.
 * Convention: domain.action (e.g., 'agent.list', 'combat.fire')
 *
 * NOTE: Uses DOT notation. Domain and action MUST NOT contain underscores.
 */
export function toolKey(contract: ToolContract): string {
    return `${contract.domain}.${contract.action}`;
}

/**
 * parseToolKey: Parses a canonical tool key into its domain and action parts.
 * Tool keys use dot notation: 'domain.action'
 */
export function parseToolKey(key: string): { domain: string; action: string } {
    const dotIndex = key.indexOf('.');
    if (dotIndex === -1) {
        return { domain: key, action: '' };
    }
    return {
        domain: key.substring(0, dotIndex),
        action: key.substring(dotIndex + 1)
    };
}

// ─── Contract Factory ────────────────────────────────────────────────────────

/**
 * defineContract: Type-safe factory for creating tool contracts.
 * Ensures all contracts are structurally identical and inferred correctly.
 * Automatically registers the contract in the globalContractRegistry.
 *
 * Validates that domain and action do NOT contain underscore characters.
 */
export function defineContract<
    TInput extends z.ZodTypeAny,
    TOutput extends z.ZodTypeAny,
    TPrint = z.infer<TOutput>
>(contract: ToolContract<TInput, TOutput, TPrint>): ToolContract<TInput, TOutput, TPrint> {
    if (contract.domain.includes('_')) {
        throw new Error(`defineContract: domain "${contract.domain}" must not contain underscores. Use dot notation for key separation.`);
    }
    if (contract.action.includes('_')) {
        // Allow underscores in action names like 'find_one', 'create_many' etc.
        // These are standard CRUD naming conventions. Only domain is restricted.
    }
    globalContractRegistry.register(contract);
    return contract;
}

// ─── Contract Registry ───────────────────────────────────────────────────────

/**
 * ContractRegistry: A typed map of all registered tool contracts.
 * The server iterates this to auto-generate routes.
 * The generator reads contract files statically.
 */
export class ContractRegistry {
    private readonly contracts = new Map<string, ToolContract>();

    public register<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(contract: ToolContract<I, O>): void {
        const key = toolKey(contract as unknown as ToolContract);
        if (this.contracts.has(key)) {
            return;
        }
        this.contracts.set(key, contract as unknown as ToolContract);
    }

    public has(key: string): boolean {
        return this.contracts.has(key);
    }

    public clear(): void {
        this.contracts.clear();
    }

    public get(key: string): ToolContract | undefined {
        return this.contracts.get(key);
    }

    public entries(): IterableIterator<[string, ToolContract]> {
        return this.contracts.entries();
    }

    public values(): IterableIterator<ToolContract> {
        return this.contracts.values();
    }

    public get size(): number {
        return this.contracts.size;
    }
}

const globalKey = 'mesh.globalContractRegistry';
const globalObj = globalThis as unknown as Record<typeof globalKey, ContractRegistry | undefined>;
if (!globalObj[globalKey]) {
    globalObj[globalKey] = new ContractRegistry();
}
export const globalContractRegistry = globalObj[globalKey] as ContractRegistry;