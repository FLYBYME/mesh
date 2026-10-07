import { z } from 'zod';
import { MeshApp } from '../../core/MeshApp.js';
import { ContextStack } from '../../core/ContextStack.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { NetworkModule } from '../../modules/NetworkModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { WSTransport } from '../../transports/node/WSTransport.js';
import { JSONSerializer } from '../../serializers/JSONSerializer.js';
import { defineContract, defaultPrint } from '../../interfaces/IToolContract.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import type { IServiceBroker } from '../../interfaces/IServiceBroker.js';

/**
 * A request entering the mesh with a trace of its own (an api request's traceparent) runs in it,
 * on this node and across a hop; and its caller is told which node the call went to -- what an
 * api response needs to say which node answered (observability-review.md T1, incident 1: two
 * versions of identity answering and nothing saying which).
 */
const traced = defineContract({
    domain: 'traced',
    action: 'where',
    description: 'Says where it ran and in which trace',
    inputSchema: z.object({}),
    outputSchema: z.object({ nodeID: z.string(), traceId: z.string() }),
    filePath: 'src/__tests__/core/CallTrace.spec.ts',
    concurrency: 'on-demand',
    permissions: [],
    print: defaultPrint,
});

declare global {
    interface IServiceToolRegistry {
        'traced.where': { params: Record<string, never>; returns: { nodeID: string; traceId: string } };
    }
}

describe('a call in a given trace', () => {
    let appA: MeshApp;
    let appB: MeshApp;
    let brokerA: IServiceBroker;
    const logger = new Logger(LogLevel.ERROR);
    const serializer = new JSONSerializer();

    beforeAll(async () => {
        appA = new MeshApp({ nodeID: 'trace-node-a', logger });
        appA.use(new RegistryModule());
        appA.use(new NetworkModule({ port: 6581, transports: [new WSTransport(serializer, 6581, '127.0.0.1')] }));
        appA.use(new BrokerModule());
        await appA.start();

        appB = new MeshApp({ nodeID: 'trace-node-b', logger });
        appB.use(new RegistryModule());
        appB.use(new NetworkModule({ port: 6582, transports: [new WSTransport(serializer, 6582, '127.0.0.1')], bootstrapNodes: ['ws://127.0.0.1:6581'] }));
        appB.use(new BrokerModule());
        await appB.start();

        // Only B serves it: a call from A crosses the hop.
        appB.getProvider<IServiceBroker>('broker').registerContract(traced, async (_params, ctx) => {
            const here = ContextStack.getContext();
            return { nodeID: ctx.nodeID, traceId: here?.traceId ?? '' };
        });
        brokerA = appA.getProvider<IServiceBroker>('broker');

        await new Promise((r) => setTimeout(r, 800));
    });

    afterAll(async () => {
        await appB.stop();
        await appA.stop();
    });

    it('runs in the trace it was given, on the far node too, and says where it went', async () => {
        const routed: string[] = [];

        const answer = await brokerA.call('traced.where', {}, { traceId: '4bf92f3577b34da6a3ce929d0e0e4736', parentSpanId: '00f067aa0ba902b7', onRouted: (n) => routed.push(n) });

        expect(answer.nodeID).toBe('trace-node-b');
        expect(answer.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
        expect(routed).toEqual(['trace-node-b']);
    }, 15000);

    it('the given trace wins over the one already active', async () => {
        const outer = { id: 'outer', correlationID: 'outer', toolName: 'x', params: {}, meta: {}, nodeID: 'trace-node-a', traceId: 'the-old-trace', spanId: 's', callerID: null };

        const answer = await ContextStack.run(outer, () => brokerA.call('traced.where', {}, { traceId: 'a-new-trace' }));

        expect(answer.traceId).toBe('a-new-trace');
    }, 15000);

    it('without one, a call keeps the active trace', async () => {
        const outer = { id: 'outer', correlationID: 'outer', toolName: 'x', params: {}, meta: {}, nodeID: 'trace-node-a', traceId: 'the-active-trace', spanId: 's', callerID: null };

        const answer = await ContextStack.run(outer, () => brokerA.call('traced.where', {}));

        expect(answer.traceId).toBe('the-active-trace');
    }, 15000);
});
