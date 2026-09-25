import { z } from 'zod';
import { ServiceBroker } from '../../core/ServiceBroker.js';
import { PlacementRegistry } from '../../core/PlacementRegistry.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import type { NodeInfo, ToolInfo } from '../../interfaces/IMeshNetwork.js';
import { defineContract, defaultPrint } from '../../interfaces/IToolContract.js';
import { declarationFromToolInfo, mergeDeclarations, toolInfoOf, type ContractDeclaration } from '../../core/ContractDeclaration.js';

/**
 * A contract's declaration travels with presence, so the api gateway can publish a contract that
 * runs on another node. Found needed exposing smtp.capture_list: it runs on surf, the api on edge1,
 * and edge1 -- which never loads smtpserver -- refused it as "not a public contract". What presence
 * carried before said `public` for every contract, internal ones included, and nothing about route
 * or permissions.
 */
const internalContract = defineContract({
    domain: 'advc',
    action: 'secret',
    description: 'An internal contract.',
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.object({ ok: z.boolean() }),
    rest: { method: 'POST', path: '/advc/secret' },
    visibility: 'internal',
    destructive: true,
    filePath: 'src/advc.ts',
    concurrency: 'on-demand',
    permissions: ['operator'],
    print: defaultPrint,
});

const logger = new Logger(LogLevel.ERROR);

function advertisedTool(key: string, overrides: Partial<ToolInfo> = {}): ToolInfo {
    const [domain, action] = key.split('.');
    return {
        name: key,
        description: 'Runs elsewhere.',
        visibility: 'public',
        rest: { method: 'GET', path: `/${domain}/${action}` },
        roles: ['operator'],
        metadata: { domain, action, isCrud: false, destructive: false },
        params: { type: 'object', properties: { limit: { type: 'number' } } },
        returns: { type: 'object' },
        ...overrides,
    };
}

function peer(nodeID: string, tools: Record<string, ToolInfo>): NodeInfo {
    return {
        nodeID,
        type: 'node',
        namespace: 'default',
        addresses: [`ws://127.0.0.1:${nodeID.length + 6500}`],
        available: true,
        timestamp: Date.now(),
        nodeSeq: 1,
        services: [{ name: 'advc', tools }],
    };
}

describe('what a node advertises for a contract', () => {
    it('tells the truth about visibility, route, permissions and destructiveness', () => {
        expect(toolInfoOf(internalContract)).toMatchObject({
            name: 'advc.secret',
            visibility: 'internal',
            rest: { method: 'POST', path: '/advc/secret' },
            roles: ['operator'],
            metadata: { domain: 'advc', action: 'secret', destructive: true },
        });
    });

    it('reads back into the same declaration a local definition gives', () => {
        const declaration = declarationFromToolInfo('advc.secret', toolInfoOf(internalContract));

        expect(declaration).toMatchObject({ key: 'advc.secret', visibility: 'internal', permissions: ['operator'], destructive: true, rest: { method: 'POST', path: '/advc/secret' } });
        expect(declaration?.input).toMatchObject({ type: 'object', properties: { id: { type: 'string' } } });
    });

    it('treats a malformed advertisement as none at all', () => {
        const good: Record<string, unknown> = { ...advertisedTool('advc.x') };
        for (const bad of [
            { ...good, rest: undefined },
            { ...good, rest: { method: 'TRACE', path: '/x' } },
            { ...good, visibility: 'published' },
            { ...good, roles: 'operator' },
            advertisedTool('advc.other'), // names a different contract than the key it was found under
        ]) {
            expect(declarationFromToolInfo('advc.x', bad)).toBeUndefined();
        }
    });
});

describe('peers that disagree', () => {
    const base: ContractDeclaration = { key: 'a.b', domain: 'a', action: 'b', description: '', rest: { method: 'GET', path: '/a/b' }, visibility: 'public', permissions: ['member'], destructive: false, input: {}, output: {} };

    it('keeps the stricter reading of each field', () => {
        expect(mergeDeclarations(base, { ...base, visibility: 'internal', permissions: ['operator'], destructive: true })).toMatchObject({ visibility: 'internal', permissions: ['member', 'operator'], destructive: true });
    });

    it('publishes neither of two different routes', () => {
        expect(mergeDeclarations(base, { ...base, rest: { method: 'POST', path: '/a/b' } })).toBeUndefined();
    });
});

describe('ServiceBroker.contractDeclaration', () => {
    let broker: ServiceBroker;
    let registry: PlacementRegistry;

    beforeEach(() => {
        broker = new ServiceBroker('local', logger);
        registry = new PlacementRegistry(logger, { localNodeID: 'local' });
        broker.registry = registry;
    });

    afterEach(async () => {
        await registry.stop();
    });

    it('uses this node\'s own definition when it has one', () => {
        expect(broker.contractDeclaration('advc.secret')).toMatchObject({ visibility: 'internal', permissions: ['operator'] });
    });

    it('falls back to what a peer that runs the contract advertises', () => {
        expect(broker.contractDeclaration('advc.remote_list')).toBeUndefined();

        registry.registerNode(peer('surf', { 'advc.remote_list': advertisedTool('advc.remote_list') }));

        expect(broker.contractDeclaration('advc.remote_list')).toMatchObject({ visibility: 'public', rest: { method: 'GET', path: '/advc/remote_list' }, permissions: ['operator'] });
    });

    it('merges two peers stricter-wins, and ignores one that is unavailable', () => {
        registry.registerNode(peer('surf', { 'advc.remote_two': advertisedTool('advc.remote_two') }));
        registry.registerNode(peer('edge2', { 'advc.remote_two': advertisedTool('advc.remote_two', { visibility: 'internal' }) }));
        expect(broker.contractDeclaration('advc.remote_two')?.visibility).toBe('internal');

        registry.registerNode({ ...peer('edge2', { 'advc.remote_two': advertisedTool('advc.remote_two', { visibility: 'internal' }) }), available: false });
        expect(broker.contractDeclaration('advc.remote_two')?.visibility).toBe('public');
    });
});
