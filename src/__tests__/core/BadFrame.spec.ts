import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { z } from 'zod';
import { MeshApp } from '../../core/MeshApp.js';
import { defineContract, defaultPrint } from '../../interfaces/IToolContract.js';
import { IServiceBroker } from '../../interfaces/IServiceBroker.js';
import { createTestNode } from '../../testing/TestNode.js';

/**
 * **A frame nobody can read is logged and dropped; the node carries on.** It was handed to the
 * transport's `error` event, which nothing listened to -- so Node threw it, from inside the
 * socket's message callback (CHECKLIST 1, "Errors").
 */
const pingContract = defineContract({
    domain: 'badframe', action: 'ping',
    description: 'Answers.',
    inputSchema: z.object({}), outputSchema: z.object({ ok: z.boolean() }),
    rest: { method: 'POST', path: '/badframe/ping' },
    filePath: 'src/__tests__/core/BadFrame.spec.ts', concurrency: 'on-demand', permissions: [],
    print: defaultPrint,
});

declare global {
    interface IServiceToolRegistry {
        'badframe.ping': { params: Record<string, never>; returns: { ok: boolean } };
    }
}

describe('a frame nobody can read', () => {
    let node: MeshApp;
    const uncaught: unknown[] = [];
    const onUncaught = (err: unknown): void => { uncaught.push(err); };

    beforeAll(async () => {
        process.on('uncaughtException', onUncaught);
        node = await createTestNode({ nodeID: 'badframe-a', port: 27431 });
        node.getProvider<IServiceBroker>('broker').registerContract(pingContract, async () => ({ ok: true }));
    });

    afterAll(async () => {
        await node.stop();
        process.off('uncaughtException', onUncaught);
    });

    it('is dropped without throwing, and the node still answers', async () => {
        const socket = new WebSocket('ws://127.0.0.1:27431');
        await new Promise<void>((resolve, reject) => { socket.once('open', () => resolve()); socket.once('error', reject); });

        socket.send('this is not a packet {');
        socket.send(Buffer.from([0xff, 0x00, 0x13]));
        await sleep(300);
        socket.close();

        expect(uncaught).toEqual([]);
        expect(await node.getProvider<IServiceBroker>('broker').call('badframe.ping', {})).toEqual({ ok: true });
    });
});
