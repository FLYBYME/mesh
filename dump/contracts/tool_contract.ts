import { z } from 'zod';

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
    /** Domain namespace, e.g. 'agent', 'entity', 'combat' */
    readonly domain: string;
    /** Action name, e.g. 'list', 'get', 'fire' */
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
    /** Optional event flag: true to dispatch default domain:action, or string to override action name */
    readonly event?: boolean | string;
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

/**
 * defineContract: Type-safe factory for creating tool contracts.
 * Ensures all contracts are structurally identical and inferred correctly.
 * Automatically registers the contract in the globalContractRegistry.
 */
export function defineContract<
    TInput extends z.ZodTypeAny,
    TOutput extends z.ZodTypeAny,
    TPrint = z.infer<TOutput>
>(contract: ToolContract<TInput, TOutput, TPrint>): ToolContract<TInput, TOutput, TPrint> {
    globalContractRegistry.register(contract);
    return contract;
}

// ─── Tool Key Generation ─────────────────────────────────────────────────────

/**
 * toolKey: Generates a canonical tool key from domain and action.
 * Convention: domain_action (e.g., 'agent_list', 'combat_fire')
 */
export function toolKey(contract: ToolContract): string {
    return `${contract.domain}_${contract.action}`;
}

/**
 * parseToolKey: Parses a canonical tool key into its domain and action parts.
 */
export function parseToolKey(toolKey: string): { domain: string; action: string } {
    const crudSuffixes = [
        '_find_one',
        '_create_many',
        '_create',
        '_find',
        '_get',
        '_update',
        '_delete',
        '_count',
        '_replace',
        '_resolve'
    ];

    for (const suffix of crudSuffixes) {
        if (toolKey.endsWith(suffix)) {
            const domain = toolKey.substring(0, toolKey.length - suffix.length);
            const action = suffix.substring(1);
            return { domain, action };
        }
    }

    const firstUnderscore = toolKey.indexOf('_');
    if (firstUnderscore === -1) {
        return { domain: toolKey, action: '' };
    }
    return {
        domain: toolKey.substring(0, firstUnderscore),
        action: toolKey.substring(firstUnderscore + 1)
    };
}

// ─── Contract Registry ───────────────────────────────────────────────────────

/**
 * ContractRegistry: A typed map of all registered tool contracts.
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
