import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ToolInfo } from '../types/registry.schema.js';
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
}

function jsonSchema(schema: ToolContract['inputSchema']): Record<string, unknown> {
    const out: unknown = zodToJsonSchema(schema);
    return typeof out === 'object' && out !== null && !Array.isArray(out) ? Object.fromEntries(Object.entries(out)) : {};
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
        output: jsonSchema(contract.outputSchema),
    };
}

/**
 * What a node advertises for one of its contracts, with its presence. It used to say `public` for
 * every contract and nothing about route or permissions -- harmless only while nothing read it.
 */
export function toolInfoOf(contract: ToolContract): ToolInfo {
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
        returns: declaration?.output ?? jsonSchema(contract.outputSchema),
        ...(contract.timeout !== undefined ? { timeout: contract.timeout } : {}),
    };
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
    };
}

/**
 * Two nodes advertising one contract differently (two builds mid-deploy, say): the stricter reading
 * of each field wins -- internal over public, every permission either demands, destructive if either
 * says so. Two different routes cannot both be right, so neither is used.
 */
export function mergeDeclarations(a: ContractDeclaration, b: ContractDeclaration): ContractDeclaration | undefined {
    if (a.rest.method !== b.rest.method || a.rest.path !== b.rest.path) return undefined;
    return {
        ...a,
        visibility: a.visibility === 'internal' || b.visibility === 'internal' ? 'internal' : 'public',
        permissions: [...new Set([...a.permissions, ...b.permissions])],
        destructive: a.destructive || b.destructive,
    };
}
