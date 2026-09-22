import { MeshApp } from '../../core/MeshApp.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { NetworkModule } from '../../modules/NetworkModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { WSTransport } from '../../transports/node/WSTransport.js';
import { JSONSerializer } from '../../serializers/JSONSerializer.js';
import { defineContract } from '../../interfaces/IToolContract.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import type { IServiceBroker } from '../../interfaces/IServiceBroker.js';
import { z } from 'zod';

/**
 * Two sequential remote calls made from inside one handler -- one call chain, one correlationID.
 *
 * executeRemote used the caller's correlationID as the request's packet id, and a receiver drops any
 * non-response packet whose id it saw in the last 10s as a duplicate. So the first nested remote
 * call in a chain worked and the second was silently discarded: the caller waited out its full
 * timeout for a request the callee never saw. Found putting a nameserver on a real second machine --
 * its zone loader calls dnsZone.find then dnsRecord.find inside the same dns.listen handler, and
 * the second timed out at exactly 10s every time (the same two calls, made as separate root calls,
 * each answered in ~25ms). One nested call per chain hid it from every earlier test.
 */
describe('sequential remote calls inside one handler', () => {
    let appA: MeshApp;
    let appB: MeshApp;
    const logger = new Logger(LogLevel.ERROR);
    const serializer = new JSONSerializer();

    const nodeOutput = z.object({ nodeID: z.string() });
    const contract = (domain: string, action: string): ReturnType<typeof defineContract> => defineContract({
        domain,
        action,
        description: `${domain}.${action}`,
        inputSchema: z.object({}),
        outputSchema: nodeOutput.or(z.object({ first: z.string(), second: z.string() })),
        dependencies: [], filePath: 'src/__tests__/core/RemoteChainCalls.spec.ts', permissions: [], concurrency: 'on-demand',
    } as never);

    beforeAll(async () => {
        appA = new MeshApp({ nodeID: 'chain-node-a', logger });
        appA.use(new RegistryModule());
        appA.use(new NetworkModule({ port: 6561, transports: [new WSTransport(serializer, 6561, '127.0.0.1')] }));
        appA.use(new BrokerModule());
        await appA.start();

        appB = new MeshApp({ nodeID: 'chain-node-b', logger });
        appB.use(new RegistryModule());
        appB.use(new NetworkModule({
            port: 6562,
            transports: [new WSTransport(serializer, 6562, '127.0.0.1')],
            bootstrapNodes: ['ws://127.0.0.1:6561'],
        }));
        appB.use(new BrokerModule());
        await appB.start();

        // one/two live only on B; run lives only on A, and makes both calls from inside its handler.
        const brokerB = appB.getProvider<IServiceBroker>('broker');
        brokerB.registerContract(contract('chain', 'one') as never, (async (_i: unknown, ctx: { nodeID: string }) => ({ nodeID: ctx.nodeID })) as never);
        brokerB.registerContract(contract('chain', 'two') as never, (async (_i: unknown, ctx: { nodeID: string }) => ({ nodeID: ctx.nodeID })) as never);

        const brokerA = appA.getProvider<IServiceBroker>('broker');
        brokerA.registerContract(contract('chain', 'run') as never, (async (_i: unknown, ctx: { broker: IServiceBroker }) => {
            // A short timeout so a dropped request fails this test in 2s, not the default 10s.
            const first = await ctx.broker.call('chain.one' as never, {} as never, { timeout: 2000 } as never) as { nodeID: string };
            const second = await ctx.broker.call('chain.two' as never, {} as never, { timeout: 2000 } as never) as { nodeID: string };
            return { first: first.nodeID, second: second.nodeID };
        }) as never);

        await new Promise((r) => setTimeout(r, 800));
    });

    afterAll(async () => {
        await appB.stop();
        await appA.stop();
    });

    it('answers both, from the node that owns them', async () => {
        // Called from B into A, so the two nested calls run inside a chain that began on another node.
        const result = await appB.getProvider<IServiceBroker>('broker').call('chain.run' as never, {} as never) as { first: string; second: string };

        expect(result).toEqual({ first: 'chain-node-b', second: 'chain-node-b' });
    }, 15000);

    it('does the same when the chain starts on the node that makes the calls', async () => {
        const result = await appA.getProvider<IServiceBroker>('broker').call('chain.run' as never, {} as never) as { first: string; second: string };

        expect(result).toEqual({ first: 'chain-node-b', second: 'chain-node-b' });
    }, 15000);
});
