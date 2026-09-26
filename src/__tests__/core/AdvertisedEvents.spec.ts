import { z } from 'zod';
import { MeshOrchestrator } from '../../core/MeshOrchestrator.js';
import { PlacementRegistry } from '../../core/PlacementRegistry.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import type { IMeshNetworkNode, NodeInfo } from '../../interfaces/IMeshNetwork.js';
import { defineEvent, EventContractRegistry } from '../../interfaces/IEventContract.js';
import { advertisableEvents, eventScope, scopeOfOccurrence } from '../../core/EventScope.js';
import { defineCrud } from '../../interfaces/ICrudContract.js';

/**
 * Event definitions travel with presence, so a node can tell who an event belongs to without loading
 * the code that defines it. Found needed streaming gitserver's push events: the api runs on one node
 * and gitserver on another, the api node never loads gitserver, and so could only answer "no module
 * loaded on this node defines it" for every one of gitserver's events.
 */
describe('advertised event definitions', () => {
    const logger = new Logger(LogLevel.ERROR);
    defineEvent('advtest.local', z.object({ tenantId: z.string() }), { scopedBy: 'tenantId' });

    let registry: PlacementRegistry;
    let sent: Array<{ target: string; topic: string; data: unknown }>;
    let orchestrator: MeshOrchestrator;

    beforeEach(() => {
        registry = new PlacementRegistry(logger, { localNodeID: 'local' });
        const local = registry.getNode('local');
        if (local === undefined) throw new Error('no local node');
        local.addresses = ['ws://127.0.0.1:6599'];
        registry.registerNode(local);
        sent = [];

        const node = {
            nodeID: 'local',
            namespace: 'default',
            logger,
            registry,
            send: async (target: string, topic: string, data: unknown): Promise<void> => { sent.push({ target, topic, data }); },
            publish: async (): Promise<void> => undefined,
        } as unknown as IMeshNetworkNode;
        orchestrator = new MeshOrchestrator(node);
    });

    afterEach(async () => {
        await registry.stop();
    });

    const peer = (events: unknown): NodeInfo => ({
        nodeID: 'peer-with-code',
        type: 'node',
        namespace: 'default',
        addresses: ['ws://127.0.0.1:6598'],
        available: true,
        timestamp: Date.now(),
        nodeSeq: 1,
        services: [],
        events,
    } as NodeInfo);

    it('sends this node\'s own definitions with its presence', async () => {
        await orchestrator.broadcastPresence();

        const presence = sent.find((s) => s.topic === '$node.presence')?.data as { node: NodeInfo } | undefined;
        expect(presence?.node.events).toContainEqual({ name: 'advtest.local', scopedBy: 'tenantId' });
    });

    it('resolves the scope of an event only a peer defines, from that peer\'s presence', async () => {
        expect(eventScope('advtest.remoteonly')).toBeUndefined();

        await orchestrator.handlePresence({ node: peer([{ name: 'advtest.remoteonly', scopedBy: 'tenantId' }]) });

        expect(eventScope('advtest.remoteonly')).toEqual({ scopedBy: 'tenantId' });
    });

    it('ignores malformed entries off the wire', async () => {
        await orchestrator.handlePresence({ node: peer([{ name: 7 }, 'nope', null, { scopedBy: 'x' }, { name: 'advtest.ok', scopedBy: 'global' }]) });

        expect(eventScope('advtest.ok')).toBe('global');
    });

    it('never lets an advertisement override this node\'s own definition', async () => {
        await orchestrator.handlePresence({ node: peer([{ name: 'advtest.local', scopedBy: 'global' }]) });

        expect(eventScope('advtest.local')).toEqual({ scopedBy: 'tenantId' });
    });
});

/**
 * A collection's CRUD events travel too. Found streaming surfdns-compute's `volume.updated`: the api
 * gateway (edge1) never loads the part that defines `volume` (surf does), so it refused the event
 * with "no module loaded on this node defines it" however the collection was declared -- while
 * mesh-serve's own `serve.part.updated` streamed, only because every node loads mesh-serve.
 */
describe('advertised CRUD events', () => {
    const logger = new Logger(LogLevel.ERROR);
    defineCrud('advcrud.scoped', z.object({ tenantId: z.string() }), { scopedBy: 'tenantId', dependencies: [], filePath: 'x', permissions: [] });
    defineCrud('advcrud.fleet', z.object({ name: z.string() }), { delivery: 'global', dependencies: [], filePath: 'x', permissions: [] });
    defineCrud('advcrud.open', z.object({ name: z.string() }), { dependencies: [], filePath: 'x', permissions: [] });

    it('advertises each collection\'s created/updated/deleted with where its scope sits', () => {
        const events = advertisableEvents();
        expect(events).toContainEqual({ name: 'advcrud.scoped.created', scopedBy: 'tenantId' });
        expect(events).toContainEqual({ name: 'advcrud.scoped.updated', scopedBy: 'item.tenantId' });
        expect(events).toContainEqual({ name: 'advcrud.scoped.deleted', scopedBy: 'tenantId' });
        expect(events).toContainEqual({ name: 'advcrud.fleet.updated', scopedBy: 'global' });
        // Unscopable, but known: a peer refuses it for that reason, not for never having heard of it.
        expect(events).toContainEqual({ name: 'advcrud.open.updated' });
    });

    it('lets a node without the collection resolve its events from a peer\'s presence', async () => {
        const registry = new PlacementRegistry(logger, { localNodeID: 'gateway' });
        const node = { nodeID: 'gateway', namespace: 'default', logger, registry, send: async () => undefined, publish: async () => undefined } as unknown as IMeshNetworkNode;
        const orchestrator = new MeshOrchestrator(node);
        try {
            expect(eventScope('advcrud.remote.updated')).toBeUndefined();
            await orchestrator.handlePresence({
                node: {
                    nodeID: 'surf', type: 'node', namespace: 'default', addresses: ['ws://127.0.0.1:6597'], available: true, timestamp: Date.now(), nodeSeq: 1, services: [],
                    events: [{ name: 'advcrud.remote.updated', scopedBy: 'item.tenantId' }, { name: 'advcrud.remote2.updated' }],
                } as NodeInfo,
            });
            expect(eventScope('advcrud.remote.updated')).toEqual({ scopedBy: 'item.tenantId' });
            expect(scopeOfOccurrence('advcrud.remote.updated', { id: '1', patch: {}, item: { tenantId: 't1' } })).toEqual({ scope: 't1' });
            expect(eventScope('advcrud.remote2.updated')).toMatchObject({ refusal: expect.stringContaining('no scopedBy') });
        } finally {
            await registry.stop();
        }
    });

    it('never lets an advertisement override this node\'s own collection', async () => {
        const registry = new PlacementRegistry(logger, { localNodeID: 'owner' });
        const node = { nodeID: 'owner', namespace: 'default', logger, registry, send: async () => undefined, publish: async () => undefined } as unknown as IMeshNetworkNode;
        const orchestrator = new MeshOrchestrator(node);
        try {
            await orchestrator.handlePresence({
                node: {
                    nodeID: 'other', type: 'node', namespace: 'default', addresses: ['ws://127.0.0.1:6596'], available: true, timestamp: Date.now(), nodeSeq: 1, services: [],
                    events: [{ name: 'advcrud.scoped.updated', scopedBy: 'global' }],
                } as NodeInfo,
            });
            expect(eventScope('advcrud.scoped.updated')).toEqual({ scopedBy: 'item.tenantId' });
        } finally {
            await registry.stop();
        }
    });
});

describe('EventContractRegistry.advertise', () => {
    it('keeps the stricter scope when different peers disagree -- one can narrow, never widen', () => {
        const registry = new EventContractRegistry();

        expect(registry.advertise('e', 'global', 'a')).toBe(true);
        expect(registry.advertise('e', 'tenantId', 'b')).toBe(true);    // stricter: decides
        expect(registry.getAdvertised('e')).toEqual({ scopedBy: 'tenantId' });

        expect(registry.advertise('e', 'global', 'c')).toBe(false);     // wider: b still decides
        expect(registry.getAdvertised('e')).toEqual({ scopedBy: 'tenantId' });

        expect(registry.advertise('e', undefined, 'd')).toBe(true);     // no scope at all: strictest
        expect(registry.getAdvertised('e')).toEqual({});
        expect(registry.advertise('e', 'tenantId', 'e')).toBe(false);
    });

    it('lets one peer\'s newer answer replace its older one -- a scope gained in a redeploy reaches the gateway', () => {
        const registry = new EventContractRegistry();
        // surf before the redeploy: volume.state_changed declared no scope.
        registry.advertiseAll('surf', [{ name: 'volume.state_changed' }]);
        expect(registry.getAdvertised('volume.state_changed')).toEqual({});
        // surf after: scoped by tenantId. Before this, the old "no scope" won until the gateway restarted.
        expect(registry.advertiseAll('surf', [{ name: 'volume.state_changed', scopedBy: 'tenantId' }])).toEqual([]);
        expect(registry.getAdvertised('volume.state_changed')).toEqual({ scopedBy: 'tenantId' });
    });

    it('forgets what a peer no longer advertises', () => {
        const registry = new EventContractRegistry();
        registry.advertiseAll('surf', [{ name: 'old.event', scopedBy: 'tenantId' }]);
        registry.advertiseAll('surf', []);
        expect(registry.getAdvertised('old.event')).toBeUndefined();
    });
});
