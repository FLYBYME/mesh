import { z } from 'zod';
import { MeshOrchestrator } from '../../core/MeshOrchestrator.js';
import { PlacementRegistry } from '../../core/PlacementRegistry.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import type { IMeshNetworkNode, NodeInfo } from '../../interfaces/IMeshNetwork.js';
import { defineEvent, EventContractRegistry } from '../../interfaces/IEventContract.js';
import { eventScope } from '../../core/EventScope.js';

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

describe('EventContractRegistry.advertise', () => {
    it('keeps the stricter scope when peers disagree -- it can narrow, never widen', () => {
        const registry = new EventContractRegistry();

        expect(registry.advertise('e', 'global')).toBe(true);
        expect(registry.advertise('e', 'tenantId')).toBe(true);    // stricter: replaces
        expect(registry.getAdvertised('e')).toEqual({ scopedBy: 'tenantId' });

        expect(registry.advertise('e', 'global')).toBe(false);     // wider: refused
        expect(registry.getAdvertised('e')).toEqual({ scopedBy: 'tenantId' });

        expect(registry.advertise('e', undefined)).toBe(true);     // no scope at all: strictest
        expect(registry.getAdvertised('e')).toEqual({});
        expect(registry.advertise('e', 'tenantId')).toBe(false);
    });
});
