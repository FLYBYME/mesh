import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { MeshApp } from '../../core/MeshApp.js';
import { defineContract, defaultPrint } from '../../interfaces/IToolContract.js';
import { IServiceBroker } from '../../interfaces/IServiceBroker.js';
import { IServiceRegistry } from '../../interfaces/IServiceRegistry.js';
import { createTestNode } from '../../testing/TestNode.js';

/**
 * **A call ends when it can no longer be answered, and its handler is told.**
 *
 * A call to a node that died waited out its whole timeout; a call that timed out left its handler
 * running with `ctx.signal` never aborted (CHECKLIST 1, "Calls").
 */
const hangContract = defineContract({
    domain: 'callends', action: 'hang',
    description: 'Waits until its signal aborts, then says so.',
    inputSchema: z.object({}), outputSchema: z.object({ done: z.boolean() }),
    rest: { method: 'POST', path: '/callends/hang' },
    filePath: 'src/__tests__/core/CallEnds.spec.ts', concurrency: 'on-demand', permissions: [],
    print: defaultPrint,
});

declare global {
    interface IServiceToolRegistry {
        'callends.hang': { params: Record<string, never>; returns: { done: boolean } };
    }
}

describe('a call ends when it can no longer be answered', () => {
    const nodes: MeshApp[] = [];
    const aborted: string[] = [];
    let brokerB: IServiceBroker;
    let registryB: IServiceRegistry;

    beforeAll(async () => {
        const a = await createTestNode({ nodeID: 'callends-a', port: 27421 });
        nodes.push(a);
        a.getProvider<IServiceBroker>('broker').registerContract(hangContract, async (_input, ctx) => {
            await new Promise<void>((resolve) => ctx.signal.addEventListener('abort', () => resolve(), { once: true }));
            aborted.push(ctx.signal.reason instanceof Error ? ctx.signal.reason.name : String(ctx.signal.reason));

            return { done: true };
        });

        const b = await createTestNode({ nodeID: 'callends-b', port: 27422, bootstrapNode: 'ws://127.0.0.1:27421' });
        nodes.push(b);
        brokerB = b.getProvider<IServiceBroker>('broker');
        registryB = b.getProvider<IServiceRegistry>('registry');

        for (let tries = 0; tries < 50 && registryB.getNode('callends-a') === undefined; tries++) await sleep(100);
    }, 20_000);

    afterAll(async () => {
        for (const node of nodes.reverse()) await node.stop();
    });

    it('a timed-out call aborts its handler\'s signal, here and on the node it was sent to', async () => {
        const brokerA = nodes[0]?.getProvider<IServiceBroker>('broker');
        if (brokerA === undefined) throw new Error('no node a');

        await expect(brokerA.call('callends.hang', {}, { timeout: 200 })).rejects.toMatchObject({ code: 'TIMEOUT' });
        await expect(brokerB.call('callends.hang', {}, { nodeID: 'callends-a', timeout: 300 })).rejects.toMatchObject({ code: 'TIMEOUT' });

        for (let tries = 0; tries < 20 && aborted.length < 2; tries++) await sleep(50);
        expect(aborted).toEqual(['TimeoutError', 'TimeoutError']);
    });

    it('a call to a node that leaves fails then, not at its timeout', async () => {
        const started = Date.now();
        const call = brokerB.call('callends.hang', {}, { nodeID: 'callends-a', timeout: 20_000 });
        await sleep(200);

        registryB.unregisterNode('callends-a');

        await expect(call).rejects.toMatchObject({ code: 'NODE_GONE', status: 503 });
        expect(Date.now() - started).toBeLessThan(5_000);
    }, 10_000);
});
