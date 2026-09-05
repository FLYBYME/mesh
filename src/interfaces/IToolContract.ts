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

// ─── Visibility ──────────────────────────────────────────────────────────────

/**
 * ContractVisibility: who is allowed to call a contract.
 *
 * - `public`   -- part of the domain's published interface; any caller may use it.
 * - `internal` -- an implementation detail of the owning domain.
 *
 * The field is optional on `ToolContract` and **absent means `internal`**. That default is
 * deliberate and is the breaking half of this change: a contract is private until its author
 * says otherwise, rather than the reverse. Auto-generated CRUD is the case that motivated it --
 * `defineCrud` mints ten globally addressable contracts per collection, and in practice the vast
 * majority are never meant to be called from outside the domain that owns the data.
 */
export type ContractVisibility = 'public' | 'internal';

/** The visibility a contract has when it does not declare one. */
export const DEFAULT_VISIBILITY: ContractVisibility = 'internal';

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
    /**
     * Who may call this contract. Absent means `internal` -- see {@link ContractVisibility}.
     * Declare `'public'` to put the contract in the domain's published interface.
     */
    readonly visibility?: ContractVisibility;
    /**
     * Contract keys this contract depends on, as `domain.action` or a bare `domain`.
     *
     * Required for `defineCrud` (see its `dependencies` option); optional here. An empty array is
     * a real answer meaning "depends on nothing" -- it is not the same as leaving it undeclared.
     */
    readonly dependencies?: readonly string[];
    /** Field that scopes this contract to a caller's tenant/organization, if any. */
    readonly scopedBy?: string;
    /** Formats the tool output as a human-readable string */
    readonly print: (output: TPrint) => string;
}

/** Resolves a contract's effective visibility, applying the `internal` default. */
export function visibilityOf(contract: Pick<ToolContract, 'visibility'>): ContractVisibility {
    return contract.visibility ?? DEFAULT_VISIBILITY;
}

/** True when a contract is part of its domain's published interface. */
export function isPublicContract(contract: Pick<ToolContract, 'visibility'>): boolean {
    return visibilityOf(contract) === 'public';
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

// ─── Dependency Declarations ─────────────────────────────────────────────────

/**
 * A dependency entry is either a full contract key (`dnsZone.get`) or a bare domain (`dnsZone`),
 * the latter meaning "this depends on that domain generally". Domains may not contain underscores
 * -- the same rule `defineContract` enforces -- while actions may (`find_one`, `create_many`).
 */
const DEPENDENCY_KEY = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9_]*)?$/;

/**
 * assertValidDependencies: rejects malformed dependency lists at definition time.
 *
 * Declaring dependencies is only worth requiring if the declarations are trustworthy, so this is
 * strict about shape and about duplicates. It deliberately does NOT check that the target exists:
 * contracts are registered at import time in whatever order the module graph happens to produce,
 * so a target may legitimately not be registered yet. Use
 * {@link ContractRegistry.findUnresolvedDependencies} once the graph is loaded for that check.
 */
export function assertValidDependencies(dependencies: readonly string[], context: string): void {
    if (!Array.isArray(dependencies)) {
        throw new Error(`${context}: dependencies must be an array of contract keys.`);
    }
    const seen = new Set<string>();
    for (const dep of dependencies) {
        if (typeof dep !== 'string' || dep.length === 0) {
            throw new Error(`${context}: dependency entries must be non-empty strings, got ${JSON.stringify(dep)}.`);
        }
        if (!DEPENDENCY_KEY.test(dep)) {
            throw new Error(
                `${context}: dependency "${dep}" is not a valid contract key. ` +
                `Use "domain.action" (e.g. "dnsZone.get") or a bare "domain".`
            );
        }
        if (seen.has(dep)) {
            throw new Error(`${context}: dependency "${dep}" is listed more than once.`);
        }
        seen.add(dep);
    }
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
        throw new Error(`defineContract: domain "${contract.domain}" must not contain underscores. Use squashed lowercase (e.g. 'toolcalls') for key separation.`);
    }
    if (contract.action.includes('_')) {
        // Allow underscores in action names like 'find_one', 'create_many' etc.
        // These are standard CRUD naming conventions. Only domain is restricted.
    }
    if (contract.dependencies !== undefined) {
        assertValidDependencies(contract.dependencies, `defineContract(${contract.domain}.${contract.action})`);
    }
    globalContractRegistry.register(contract);
    return contract;
}

// ─── Contract Registry ───────────────────────────────────────────────────────

/**
 * ContractRegistry: A typed map of all registered tool contracts.
 * Populated at import time by defineContract. Consumed by:
 *   - Server (auto-route registration)
 *   - API (resolving a contract key into a route and schema)
 *   - Generator (static contract discovery)
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

    /**
     * publicContracts: the published interface across every registered domain.
     *
     * This -- not `values()` -- is what tooling that describes the system to a human or an agent
     * should iterate. The gap between the two is the point of the visibility field: a registry of
     * 1,500 contracts whose public surface is 600 costs an agent 900 contracts of context it can
     * never legitimately call.
     */
    public publicContracts(): ToolContract[] {
        return [...this.contracts.values()].filter(isPublicContract);
    }

    /** Contracts that are implementation details of their owning domain. */
    public internalContracts(): ToolContract[] {
        return [...this.contracts.values()].filter(c => !isPublicContract(c));
    }

    /** Every contract belonging to one domain, public and internal alike. */
    public byDomain(domain: string): ToolContract[] {
        return [...this.contracts.values()].filter(c => c.domain === domain);
    }

    /**
     * findUnresolvedDependencies: declared dependencies that match no registered contract.
     *
     * Run this after the module graph is loaded -- `defineContract` cannot check targets itself,
     * because import order decides what is registered when. A bare `domain` entry resolves if the
     * domain has any contract at all; a `domain.action` entry must match exactly.
     */
    public findUnresolvedDependencies(): Array<{ contract: string; dependency: string }> {
        const domains = new Set<string>();
        for (const contract of this.contracts.values()) {
            domains.add(contract.domain);
        }
        const unresolved: Array<{ contract: string; dependency: string }> = [];
        for (const [key, contract] of this.contracts) {
            for (const dep of contract.dependencies ?? []) {
                const resolved = dep.includes('.') ? this.contracts.has(dep) : domains.has(dep);
                if (!resolved) {
                    unresolved.push({ contract: key, dependency: dep });
                }
            }
        }
        return unresolved;
    }
}

const globalKey = 'mesh.globalContractRegistry';
const globalObj = globalThis as unknown as Record<typeof globalKey, ContractRegistry | undefined>;
if (!globalObj[globalKey]) {
    globalObj[globalKey] = new ContractRegistry();
}
export const globalContractRegistry = globalObj[globalKey] as ContractRegistry;