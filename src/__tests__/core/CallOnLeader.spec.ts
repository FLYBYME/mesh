import { MeshApp } from '../../core/MeshApp.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { NetworkModule } from '../../modules/NetworkModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { WSTransport } from '../../transports/node/WSTransport.js';
import { JSONSerializer } from '../../serializers/JSONSerializer.js';
import { ServiceModule } from '../../core/ServiceModule.js';
import { defineContract } from '../../interfaces/IToolContract.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { ServiceBroker } from '../../core/ServiceBroker.js';
import { Registry } from '../../core/Registry.js';
import { z } from 'zod';

/**
 * The real thing Registry.leaderFor + ServiceBroker.callOnLeader exist for: two nodes both
 * running the same domain, and a claim-shaped call landing on exactly one of them every time,
 * regardless of which node the caller happens to be sitting on. A single-process test can't prove
 * this -- it can only prove the function doesn't throw. This spins up two real, separately
 * networked MeshApp instances (same pattern as RemoteDateCall.spec.ts) so "runs on one physical
 * node" is actually observed, not assumed.
 */
describe('ServiceBroker.callOnLeader', () => {
    let appA: MeshApp;
    let appB: MeshApp;
    const logger = new Logger(LogLevel.ERROR);
    const serializer = new JSONSerializer();

    const whereInputSchema = z.object({});
    const whereOutputSchema = z.object({ nodeID: z.string() });

    const whereContract = defineContract({
        domain: 'claimable',
        action: 'where',
        description: 'Reports which node actually executed this',
        inputSchema: whereInputSchema,
        outputSchema: whereOutputSchema,
        dependencies: [],
    });

    class ClaimableService extends ServiceModule {
        readonly domain = 'claimable';
        constructor() {
            super();
            this.mountTool(whereContract, async (_input, ctx) => ({ nodeID: ctx.nodeID }));
        }
    }

    beforeAll(async () => {
        appA = new MeshApp({ nodeID: 'leader-test-node-a', logger });
        appA.use(new RegistryModule());
        appA.use(new NetworkModule({
            port: 6511,
            transports: [new WSTransport(serializer, 6511, '127.0.0.1')],
        }));
        appA.use(new BrokerModule());
        await appA.start();
        await appA.registerModule(new ClaimableService());

        appB = new MeshApp({ nodeID: 'leader-test-node-b', logger });
        appB.use(new RegistryModule());
        appB.use(new NetworkModule({
            port: 6512,
            transports: [new WSTransport(serializer, 6512, '127.0.0.1')],
            bootstrapNodes: ['ws://127.0.0.1:6511'],
        }));
        appB.use(new BrokerModule());
        await appB.start();
        await appB.registerModule(new ClaimableService());

        // Let presence gossip settle both ways before either side computes a leader from it.
        await new Promise((r) => setTimeout(r, 800));
    });

    afterAll(async () => {
        await appB?.stop();
        await appA?.stop();
    });

    it('both nodes agree on the same leader for the domain', () => {
        const registryA = appA.getProvider<Registry>('registry');
        const registryB = appB.getProvider<Registry>('registry');

        const leaderSeenByA = registryA.leaderFor('claimable');
        const leaderSeenByB = registryB.leaderFor('claimable');

        expect(leaderSeenByA).toBeDefined();
        expect(leaderSeenByB).toBeDefined();
        expect(leaderSeenByA!.nodeID).toBe(leaderSeenByB!.nodeID);
    });

    it('routes to the same physical node regardless of which node the caller is on', async () => {
        const brokerA = appA.getProvider<ServiceBroker>('broker');
        const brokerB = appB.getProvider<ServiceBroker>('broker');

        const fromA = await brokerA.callOnLeader('claimable', 'claimable.where', {}) as { nodeID: string };
        const fromB = await brokerB.callOnLeader('claimable', 'claimable.where', {}) as { nodeID: string };

        expect(fromA.nodeID).toBe(fromB.nodeID);
        expect(['leader-test-node-a', 'leader-test-node-b']).toContain(fromA.nodeID);
    });

    it('agrees with Registry.leaderFor about which node actually ran it', async () => {
        const brokerA = appA.getProvider<ServiceBroker>('broker');
        const registryA = appA.getProvider<Registry>('registry');

        const leader = registryA.leaderFor('claimable');
        const result = await brokerA.callOnLeader('claimable', 'claimable.where', {}) as { nodeID: string };

        expect(result.nodeID).toBe(leader!.nodeID);
    });

    it('throws when nothing runs the domain', async () => {
        const brokerA = appA.getProvider<ServiceBroker>('broker');
        await expect(
            brokerA.callOnLeader('nonexistent-domain', 'nonexistent-domain.anything' as never, {}),
        ).rejects.toThrow('No node currently runs domain "nonexistent-domain"');
    });
});
