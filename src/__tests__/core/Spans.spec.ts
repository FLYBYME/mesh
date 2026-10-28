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

const kickoff = defineContract({
    domain: 'spantest', action: 'kickoff', description: 'Starts a pass and returns at once',
    inputSchema: z.object({}), outputSchema: z.object({}),
    filePath: 'src/__tests__/core/Spans.spec.ts', concurrency: 'on-demand', permissions: [], print: defaultPrint,
});

const listen = defineContract({
    domain: 'spantest', action: 'listen', description: 'A listener: works, raises and writes from its own context',
    inputSchema: z.object({}), outputSchema: z.object({}),
    filePath: 'src/__tests__/core/Spans.spec.ts', concurrency: 'long-running', permissions: [], print: defaultPrint,
});

declare global {
    interface IServiceToolRegistry {
        'spantest.work': { params: Record<string, never>; returns: { n: number } };
        'spantest.kickoff': { params: Record<string, never>; returns: Record<string, never> };
        'spantest.listen': { params: Record<string, never>; returns: Record<string, never> };
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

        expect(call).toMatchObject({ traceId: 'request-1', parentId: 'the-gateway', nodeID: 'spans-node', from: 'spans-node', organization: 'acme', outcome: 'ok' });
        expect(read).toMatchObject({ traceId: 'request-1', parentId: call?.spanId, outcome: 'ok' });
        expect(event).toMatchObject({ traceId: 'request-1', parentId: call?.spanId, organization: 'acme', outcome: 'ok' });
        expect(call?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('starts a trace of its own for work the node sets going itself, even from inside a request (10-28)', async () => {
        spans.length = 0;
        broker.setSpanSink((s) => spans.push(s));
        let pass: Promise<unknown> = Promise.resolve();
        broker.registerContract(kickoff, async () => {
            pass = broker.inNewTrace('spantest.pass', () => broker.call('spantest.work', {}));
            return {};
        });

        await broker.call('spantest.kickoff', {}, { meta: { tenant_id: 'acme' }, traceId: 'request-2' });
        await pass;

        const task = spans.find((s) => s.kind === 'task');
        const work = spans.find((s) => s.kind === 'call' && s.name === 'spantest.work');
        expect(task).toMatchObject({ name: 'spantest.pass', nodeID: 'spans-node', organization: 'acme', outcome: 'ok' });
        expect(task?.traceId).not.toBe('request-2');
        expect(task?.parentId).toBeUndefined();
        expect(work).toMatchObject({ traceId: task?.traceId, parentId: task?.spanId });
    });

    it('what a long-running contract does from its own context is a trace each, not one as long as it runs (10-28)', async () => {
        spans.length = 0;
        broker.setSpanSink((s) => spans.push(s));
        broker.registerContract(listen, async (_params, ctx) => {
            await ctx.call('spantest.work', {});
            await ctx.call('spantest.work', {});
            ctx.emit('spantest.done', { tenantId: 'acme' });
            await ctx.db('spannote').find({ query: {} });
            return {};
        });

        await broker.call('spantest.listen', {}, { meta: { tenant_id: 'acme' } });
        await new Promise((r) => setTimeout(r, 100));

        const listening = spans.find((s) => s.kind === 'call' && s.name === 'spantest.listen');
        const works = spans.filter((s) => s.kind === 'call' && s.name === 'spantest.work');
        const events = spans.filter((s) => s.kind === 'event');
        const reads = spans.filter((s) => s.kind === 'db');
        expect(works).toHaveLength(2);
        expect(events).toHaveLength(3);
        expect(reads).toHaveLength(3);

        // Each piece of work its own root; what it does in turn stays under it.
        const traces = new Set([listening?.traceId, ...works.map((s) => s.traceId)]);
        expect(traces.size).toBe(3);
        for (const w of works) expect(w.parentId).toBeUndefined();
        for (const w of works) {
            expect(events.filter((e) => e.traceId === w.traceId && e.parentId === w.spanId)).toHaveLength(1);
            expect(reads.filter((r) => r.traceId === w.traceId && r.parentId === w.spanId)).toHaveLength(1);
        }

        // Raised and written from the listener itself: roots too, outside the listener's trace.
        const raised = events.find((e) => !works.some((w) => w.traceId === e.traceId));
        const written = reads.find((r) => !works.some((w) => w.traceId === r.traceId));
        expect(raised?.parentId).toBeUndefined();
        expect(raised?.traceId).not.toBe(listening?.traceId);
        expect(written?.parentId).toBeUndefined();
        expect(written?.traceId).not.toBe(listening?.traceId);
    });

    it('a sink that throws never fails the work', async () => {
        broker.setSpanSink(() => { throw new Error('sink down'); });

        await expect(broker.call('spantest.work', {}, { meta: { tenant_id: 'acme' } })).resolves.toEqual({ n: 0 });
    });
});
