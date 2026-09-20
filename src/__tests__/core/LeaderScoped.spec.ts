import { MeshApp } from '../../core/MeshApp.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { NetworkModule } from '../../modules/NetworkModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { WSTransport } from '../../transports/node/WSTransport.js';
import { JSONSerializer } from '../../serializers/JSONSerializer.js';
import { defineContract } from '../../interfaces/IToolContract.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { ServiceBroker } from '../../core/ServiceBroker.js';
import { Registry } from '../../core/Registry.js';
import { z } from 'zod';

/**
 * The point of `leaderScoped`: a handler that never mentions leaderFor/callOnLeader at all still
 * only ever runs on one physical node -- ServiceBroker resolves that itself, at dispatch, before
 * the handler body runs. Two real nodes, same shape as CallOnLeader.spec.ts, but this time the
 * contract declares the requirement instead of the handler checking it by hand.
 */
describe('leaderScoped contracts', () => {
    let appA: MeshApp;
    let appB: MeshApp;
    const logger = new Logger(LogLevel.ERROR);
    const serializer = new JSONSerializer();

    const whereInputSchema = z.object({});
    const whereOutputSchema = z.object({ nodeID: z.string() });

    // A module that owns two real domains, matching the real shape this exists for (a crud's own
    // domain differing from the module that mounts it) -- `pinned` is the crud-sub-domain-style
    // contract; leaderScoped has to resolve against `pinnable` (the module's own domain), not
    // `pinned`, or this reproduces exactly the bug leaderScoped was built to make impossible.
    const pinnedWhereContract = defineContract({
        domain: 'pinned',
        action: 'where',
        description: 'Reports which node actually executed this -- must always be the leader',
        inputSchema: whereInputSchema,
        outputSchema: whereOutputSchema,
        dependencies: [], filePath: 'src/__tests__/core/LeaderScoped.spec.ts', permissions: [], concurrency: 'on-demand',
        leaderScoped: true,
    });

    const unpinnedWhereContract = defineContract({
        domain: 'pinned',
        action: 'whereUnpinned',
        description: 'Reports which node actually executed this -- no leaderScoped, runs wherever called',
        inputSchema: whereInputSchema,
        outputSchema: whereOutputSchema,
        dependencies: [], filePath: 'src/__tests__/core/LeaderScoped.spec.ts', permissions: [], concurrency: 'on-demand',
    });

    const registerPinnable = (app: MeshApp): void => {
        const broker = app.getProvider<IServiceBroker>('broker');
        broker.registerContract(pinnedWhereContract, async (_input, ctx) => ({ nodeID: ctx.nodeID }));
        broker.registerContract(unpinnedWhereContract, async (_input, ctx) => ({ nodeID: ctx.nodeID }));
    };

    beforeAll(async () => {
        appA = new MeshApp({ nodeID: 'leaderscoped-node-a', logger });
        appA.use(new RegistryModule());
        appA.use(new NetworkModule({
            port: 6531,
            transports: [new WSTransport(serializer, 6531, '127.0.0.1')],
        }));
        appA.use(new BrokerModule());
        await appA.start();
        registerPinnable(appA);

        appB = new MeshApp({ nodeID: 'leaderscoped-node-b', logger });
        appB.use(new RegistryModule());
        appB.use(new NetworkModule({
            port: 6532,
            transports: [new WSTransport(serializer, 6532, '127.0.0.1')],
            bootstrapNodes: ['ws://127.0.0.1:6531'],
        }));
        appB.use(new BrokerModule());
        await appB.start();
        registerPinnable(appB);

        await new Promise((r) => setTimeout(r, 800));
    });

    afterAll(async () => {
        await appB?.stop();
        await appA?.stop();
    });

    it('resolves leadership against the contract\'s domain, which is now the only domain there is', () => {
        // This used to assert the opposite -- leadership resolved against the *module's* domain
        // ('pinnable'), not the contract's ('pinned') -- because a ServiceModule could own
        // contracts across several domains while advertising only its own, and asking leaderFor
        // about the wrong one returned undefined. That was a real silent failure, caught live in
        // mesh-infer.
        //
        // With contracts there is no second domain to be wrong about: a contract is advertised
        // under its own domain and leadership resolves against that. The ambiguity the original
        // test guarded is gone rather than fixed.
        const registryA = appA.getProvider<Registry>('registry');
        const registryB = appB.getProvider<Registry>('registry');

        const leaderA = registryA.leaderFor('pinned');
        const leaderB = registryB.leaderFor('pinned');
        expect(leaderA).toBeDefined();
        expect(leaderB!.nodeID).toBe(leaderA!.nodeID);
    });

    it('a leaderScoped call always lands on the leader, regardless of which node it started on, with no callOnLeader in the handler', async () => {
        const brokerA = appA.getProvider<ServiceBroker>('broker');
        const brokerB = appB.getProvider<ServiceBroker>('broker');
        const registryA = appA.getProvider<Registry>('registry');

        const leader = registryA.leaderFor('pinned');
        const fromA = await brokerA.call('pinned.where', {}) as { nodeID: string };
        const fromB = await brokerB.call('pinned.where', {}) as { nodeID: string };

        expect(fromA.nodeID).toBe(leader!.nodeID);
        expect(fromB.nodeID).toBe(leader!.nodeID);
    });

    it('a non-leaderScoped call on the same module runs wherever it was invoked, not forced to the leader', async () => {
        const brokerA = appA.getProvider<ServiceBroker>('broker');
        const brokerB = appB.getProvider<ServiceBroker>('broker');

        const fromA = await brokerA.call('pinned.whereUnpinned', {}) as { nodeID: string };
        const fromB = await brokerB.call('pinned.whereUnpinned', {}) as { nodeID: string };

        expect(fromA.nodeID).toBe('leaderscoped-node-a');
        expect(fromB.nodeID).toBe('leaderscoped-node-b');
    });
});
