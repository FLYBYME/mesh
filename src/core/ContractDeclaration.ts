import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ToolInfo } from '../types/registry.schema.js';
import { globalCrudRegistry } from '../interfaces/ICrudContract.js';
import { toolKey, visibilityOf, type ContractVisibility, type HttpMethod, type RestMeta, type ToolContract } from '../interfaces/IToolContract.js';

/**
 * What a node that does not run a contract needs to know about it to publish it: how it is called
 * (route), who may call it (visibility, permissions), whether calling it changes things, and its
 * input and output as JSON Schema. The api gateway runs on one node and publishes contracts that
 * run on others -- smtp.capture_list runs on surf, the api on edge1 -- and a node knows the
 * contracts it loaded, plus what the nodes that run the rest advertise with their presence.
 */
export interface ContractDeclaration {
    readonly key: string;
    readonly domain: string;
    readonly action: string;
    readonly description: string;
    readonly rest: RestMeta;
    readonly visibility: ContractVisibility;
    readonly permissions: readonly string[];
    readonly destructive: boolean;
    readonly input: Record<string, unknown>;
    readonly output: Record<string, unknown>;
    /**
     * How long a call may run, in ms, when the contract says (absent: the broker's default). A
     * caller on another node needs it as much as the route: the api gateway on edge1 called
     * machine.import (running on surf, declared 30 minutes) with the 10 s default and answered 500
     * while the import carried on.
     */
    readonly timeout?: number;
}

function jsonSchema(schema: ToolContract['inputSchema']): Record<string, unknown> {
    const out: unknown = zodToJsonSchema(schema);
    return typeof out === 'object' && out !== null && !Array.isArray(out) ? Object.fromEntries(Object.entries(out)) : {};
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A JSON Schema without `fields`: from an object's `properties` and `required`, through array
 * `items` and `anyOf`/`oneOf` (how an optional output renders). Nothing else is walked -- a CRUD
 * output is a record, a list of records, or an optional record.
 */
function withoutFields(schema: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
    const out: Record<string, unknown> = { ...schema };
    if (isObject(schema.properties)) {
        out.properties = Object.fromEntries(Object.entries(schema.properties).filter(([key]) => !fields.includes(key)));
        if (Array.isArray(schema.required)) out.required = schema.required.filter((key) => !fields.includes(String(key)));
    }
    if (isObject(schema.items)) out.items = withoutFields(schema.items, fields);
    for (const union of ['anyOf', 'oneOf'] as const) {
        const members = schema[union];
        if (Array.isArray(members)) out[union] = members.map((m) => (isObject(m) ? withoutFields(m, fields) : m));
    }
    return out;
}

/**
 * A contract's described output. For a CRUD contract, the collection's `hidden` fields are left
 * out whatever schema this copy of the contract carries: parts in one process share the contract
 * registry, and a stale copy registered last used to describe a hidden field (dnsZone's private
 * key) as an output. The CRUD registry keeps every field any copy declared hidden.
 */
function outputOf(contract: ToolContract): Record<string, unknown> {
    const output = jsonSchema(contract.outputSchema);
    if (contract.isCrud !== true) return output;
    const hidden = globalCrudRegistry.get(contract.domain)?.hidden ?? [];
    return hidden.length === 0 ? output : withoutFields(output, hidden);
}

/**
 * The declaration of a contract this node has loaded. None for a contract built without a route --
 * nothing typed allows that, but a hand-built one can reach here, and it cannot be published.
 */
export function declarationOf(contract: ToolContract): ContractDeclaration | undefined {
    if (!contract.rest || !isMethod(contract.rest.method) || typeof contract.rest.path !== 'string') return undefined;
    return {
        key: toolKey(contract),
        domain: contract.domain,
        action: contract.action,
        description: contract.description,
        rest: contract.rest,
        visibility: visibilityOf(contract),
        permissions: [...(contract.permissions ?? [])],
        destructive: contract.destructive === true,
        input: jsonSchema(contract.inputSchema),
        output: outputOf(contract),
        ...(contract.timeout !== undefined ? { timeout: contract.timeout } : {}),
    };
}

/**
 * What a node advertises for one of its contracts, with its presence. It used to say `public` for
 * every contract and nothing about route or permissions -- harmless only while nothing read it.
 */
export function toolInfoOf(contract: ToolContract, hash?: string): ToolInfo {
    const declaration = declarationOf(contract);
    return {
        name: toolKey(contract),
        description: contract.description,
        visibility: visibilityOf(contract),
        // No route, no advertised route: peers then cannot publish it, which is right.
        ...(declaration ? { rest: { method: declaration.rest.method, path: declaration.rest.path, ...(declaration.rest.isStream ? { isStream: true } : {}) } } : {}),
        roles: [...(contract.permissions ?? [])],
        metadata: { domain: contract.domain, action: contract.action, isCrud: contract.isCrud === true, destructive: contract.destructive === true },
        params: declaration?.input ?? jsonSchema(contract.inputSchema),
        returns: declaration?.output ?? outputOf(contract),
        ...(contract.timeout !== undefined ? { timeout: contract.timeout } : {}),
        ...(hash !== undefined ? { hash } : {}),
    };
}

/**
 * A short fingerprint of what serves a contract: its advertised declaration and its handler's
 * source. Two nodes serving one name with different code show different hashes -- what nothing
 * showed on 2026-10-06, when two versions of identity answered the same call differently.
 *
 * Not a security hash, and not the whole truth: a change in a module the handler imports leaves
 * the handler's own text alone. That is what the node's software versions are for
 * (`setLocalSoftware`); the two together say what a node runs. cyrb53, so it needs no crypto module
 * and works in the browser bundle too.
 */
export function contractHash(contract: ToolContract, handler: (...args: never[]) => unknown): string {
    const text = `${JSON.stringify(toolInfoOf(contract))}\n${handler.toString()}`;
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 2654435761);
        h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

const METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function isMethod(value: unknown): value is HttpMethod {
    return typeof value === 'string' && METHODS.some((m) => m === value);
}

function field(record: unknown, name: string): unknown {
    return typeof record === 'object' && record !== null && name in record ? Reflect.get(record, name) : undefined;
}

function plainObject(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : undefined;
}

/**
 * Reads one advertised tool off the wire. Anything malformed is no declaration at all -- a peer
 * that cannot say how its contract is called and who may call it has not published it.
 */
export function declarationFromToolInfo(key: string, info: unknown): ContractDeclaration | undefined {
    const rest = field(info, 'rest');
    const method = field(rest, 'method');
    const path = field(rest, 'path');
    const visibility = field(info, 'visibility');
    const roles = field(info, 'roles');
    const metadata = field(info, 'metadata');
    const domain = field(metadata, 'domain');
    const action = field(metadata, 'action');
    if (!isMethod(method) || typeof path !== 'string' || !path.startsWith('/')) return undefined;
    if (visibility !== 'public' && visibility !== 'internal') return undefined;
    if (!Array.isArray(roles) || !roles.every((r) => typeof r === 'string')) return undefined;
    if (typeof domain !== 'string' || typeof action !== 'string' || `${domain}.${action}` !== key) return undefined;
    const description = field(info, 'description');
    const timeout = field(info, 'timeout');
    return {
        key,
        domain,
        action,
        description: typeof description === 'string' ? description : '',
        rest: { method, path, ...(field(rest, 'isStream') === true ? { isStream: true } : {}) },
        visibility,
        permissions: roles,
        destructive: field(metadata, 'destructive') === true,
        input: plainObject(field(info, 'params')) ?? {},
        output: plainObject(field(info, 'returns')) ?? {},
        ...(typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0 ? { timeout } : {}),
    };
}

/**
 * Two nodes advertising one contract differently (two builds mid-deploy, say): the stricter reading
 * of each field wins -- internal over public, every permission either demands, destructive if either
 * says so. Two different routes cannot both be right, so neither is used. The longer timeout wins:
 * cutting off a call one build allows to run is the worse mistake.
 */
export function mergeDeclarations(a: ContractDeclaration, b: ContractDeclaration): ContractDeclaration | undefined {
    if (a.rest.method !== b.rest.method || a.rest.path !== b.rest.path) return undefined;
    const timeout = a.timeout === undefined ? b.timeout : b.timeout === undefined ? a.timeout : Math.max(a.timeout, b.timeout);
    const { timeout: _dropped, ...rest } = a;
    return {
        ...rest,
        visibility: a.visibility === 'internal' || b.visibility === 'internal' ? 'internal' : 'public',
        permissions: [...new Set([...a.permissions, ...b.permissions])],
        destructive: a.destructive || b.destructive,
        ...(timeout !== undefined ? { timeout } : {}),
    };
}
