import { z } from 'zod';
import { createTestApp, destroyTestApp, dropTestCollection } from '../helpers/setup.js';
import { MeshApp } from '../../core/MeshApp.js';
import { ServiceBroker } from '../../core/ServiceBroker.js';
import { defineCrud } from '../../interfaces/ICrudContract.js';
import { defineContract, defaultPrint } from '../../interfaces/IToolContract.js';
import { defineEvent } from '../../interfaces/IEventContract.js';
import { defineEventHandler } from '../../interfaces/IEventHandler.js';
import type { Span } from '../../interfaces/ISpan.js';

/**
 * A request's whole path, from spans: the call it made, the database read inside it, and the event
 * it raised, handled -- one trace, each under its parent (observability-review.md T2: trace ids were
 * made and carried, and no span was ever recorded).
 */
const NoteSchema = z.object({ text: z.string(), tenantId: z.string() });
const noteCrud = defineCrud('spannote', NoteSchema, {
    scopedBy: 'tenantId', dependencies: [], filePath: 'src/__tests__/core/Spans.spec.ts', permissions: [],
});
defineEvent('spantest.done', z.object({ tenantId: z.string() }), { scopedBy: 'tenantId' });
const work = defineContract({
    domain: 'spantest', action: 'work', description: 'Reads, then says it is done',
    inputSchema: z.object({}), outputSchema: z.object({ n: z.number() }),
    filePath: 'src/__tests__/core/Spans.spec.ts', concurrency: 'on-demand', permissions: [], print: defaultPrint,
});

declare global {
    interface IServiceToolRegistry {
        'spantest.work': { params: Record<string, never>; returns: { n: number } };
    }
    interface IServiceCollectionRegistry {
        'spannote': { id: string; text: string; tenantId: string; createdAt: Date; updatedAt: Date };
    }
    interface EventRegistry {
        'spantest.done': { tenantId: string };
    }
}

describe('spans', () => {
    let app: MeshApp;
    let broker: ServiceBroker;
    const spans: Span[] = [];

    beforeAll(async () => {
        app = await createTestApp('spans-node');
        broker = app.getProvider<ServiceBroker>('broker');
        broker.registerCrud(noteCrud);
        broker.registerContract(work, async (_params, ctx) => {
            const n = (await ctx.db('spannote').find({ query: {} })).length;
            ctx.emit('spantest.done', { tenantId: 'acme' });
            return { n };
        });
        broker.registerEventHandler(
            defineEventHandler({ event: 'spantest.done', domain: 'spantest', delivery: 'each', description: 'test' }),
            async () => undefined,
        );
        await dropTestCollection('spannote');
    });

    afterAll(async () => {
        broker.setSpanSink(undefined);
        await destroyTestApp(app);
    });

    it('records nothing without a sink', async () => {
        await broker.call('spantest.work', {}, { meta: { tenant_id: 'acme' } });

        expect(spans).toEqual([]);
    });

    it('records the call, its database read and the event it raised, in one trace, each under its parent', async () => {
        broker.setSpanSink((s) => spans.push(s));

        await broker.call('spantest.work', {}, { meta: { tenant_id: 'acme' }, traceId: 'request-1', parentSpanId: 'the-gateway' });
        await new Promise((r) => setTimeout(r, 100));

        const call = spans.find((s) => s.kind === 'call' && s.name === 'spantest.work');
        const read = spans.find((s) => s.kind === 'db' && s.name === 'spannote.find');
        const event = spans.find((s) => s.kind === 'event' && s.name === 'spantest.done');

        expect(call).toMatchObject({ traceId: 'request-1', parentId: 'the-gateway', nodeID: 'spans-node', organization: 'acme', outcome: 'ok' });
        expect(read).toMatchObject({ traceId: 'request-1', parentId: call?.spanId, outcome: 'ok' });
        expect(event).toMatchObject({ traceId: 'request-1', parentId: call?.spanId, organization: 'acme', outcome: 'ok' });
        expect(call?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('a sink that throws never fails the work', async () => {
        broker.setSpanSink(() => { throw new Error('sink down'); });

        await expect(broker.call('spantest.work', {}, { meta: { tenant_id: 'acme' } })).resolves.toEqual({ n: 0 });
    });
});
