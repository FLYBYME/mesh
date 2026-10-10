import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { MeshApp } from '../../core/MeshApp.js';
import { defineContract, defaultPrint } from '../../interfaces/IToolContract.js';
import { IServiceBroker } from '../../interfaces/IServiceBroker.js';
import { createTestNode } from '../../testing/TestNode.js';

const echoContract = defineContract({
    domain: 'testnodeecho', action: 'say',
    description: 'Says back what it was told, and which node said it.',
    inputSchema: z.object({ text: z.string() }), outputSchema: z.object({ text: z.string(), nodeID: z.string() }),
    rest: { method: 'POST', path: '/testnodeecho/say' },
    filePath: 'src/__tests__/core/TestNode.spec.ts', concurrency: 'on-demand', permissions: [],
    print: defaultPrint,
});

declare global {
    interface IServiceToolRegistry {
        'testnodeecho.say': { params: { text: string }; returns: { text: string; nodeID: string } };
    }
}

/** createTestNode: two real nodes, the second joining the first, and a call across them. */
describe('createTestNode', () => {
    const nodes: MeshApp[] = [];

    afterAll(async () => {
        for (const node of nodes.reverse()) await node.stop();
    });

    it('two nodes find each other: a contract only A runs answers a call made on B', async () => {
        const a = await createTestNode({ nodeID: 'test-node-a', port: 27411 });
        nodes.push(a);
        a.getProvider<IServiceBroker>('broker').registerContract(echoContract, async (input, ctx) => ({ text: input.text, nodeID: ctx.nodeID }));

        const b = await createTestNode({ nodeID: 'test-node-b', port: 27412, bootstrapNode: 'ws://127.0.0.1:27411' });
        nodes.push(b);
        const brokerB = b.getProvider<IServiceBroker>('broker');

        let answer: { text: string; nodeID: string } | undefined;
        for (let tries = 0; tries < 50 && answer === undefined; tries++) {
            answer = await brokerB.call('testnodeecho.say', { text: 'hello' }).catch(() => undefined);
            if (answer === undefined) await sleep(100);
        }

        expect(answer).toEqual({ text: 'hello', nodeID: 'test-node-a' });
    }, 20_000);
});
