import { z } from 'zod';
import { createTestApp, destroyTestApp, dropTestCollection } from '../helpers/setup.js';
import { MeshApp } from '../../core/MeshApp.js';
import { ServiceBroker } from '../../core/ServiceBroker.js';
import { MeshMetrics } from '../../metrics/MeshMetrics.js';
import { defineCrud } from '../../interfaces/ICrudContract.js';
import { defineContract, defaultPrint } from '../../interfaces/IToolContract.js';

/**
 * Database time, counted wherever it is spent: a CRUD call through the broker, or ctx.db straight to
 * the database -- which passed no metric at all before (observability-review.md T2).
 */
const WidgetSchema = z.object({ label: z.string(), tenantId: z.string() });
const widgetCrud = defineCrud('dbmwidget', WidgetSchema, {
    scopedBy: 'tenantId',
    dependencies: [], filePath: 'src/__tests__/metrics/DbMetrics.spec.ts', permissions: [],
});
const countThem = defineContract({
    domain: 'dbm', action: 'count', description: 'Reads widgets through ctx.db',
    inputSchema: z.object({}), outputSchema: z.object({ n: z.number() }),
    filePath: 'src/__tests__/metrics/DbMetrics.spec.ts', concurrency: 'on-demand', permissions: [], print: defaultPrint,
});

declare global {
    interface IServiceToolRegistry {
        'dbmwidget.create': { params: { label: string }; returns: { id: string; label: string; tenantId: string } };
        'dbm.count': { params: Record<string, never>; returns: { n: number } };
    }
    interface IServiceCollectionRegistry {
        'dbmwidget': { id: string; label: string; tenantId: string; createdAt: Date; updatedAt: Date };
    }
}

describe('database operations, measured', () => {
    let app: MeshApp;
    let broker: ServiceBroker;
    const metrics = new MeshMetrics();
    const acme = { meta: { tenant_id: 'acme' } };

    beforeAll(async () => {
        app = await createTestApp('db-metrics-node');
        broker = app.getProvider<ServiceBroker>('broker');
        broker.metrics = metrics;
        broker.registerCrud(widgetCrud);
        broker.registerContract(countThem, async (_params, ctx) => ({ n: (await ctx.db('dbmwidget').find({ query: {} })).length }));
        await dropTestCollection('dbmwidget');
    });

    afterAll(async () => {
        await destroyTestApp(app);
    });

    it('counts and times a CRUD call and a ctx.db read alike, by collection and action', async () => {
        await broker.call('dbmwidget.create', { label: 'one' }, acme);
        const { n } = await broker.call('dbm.count', {}, acme);

        expect(n).toBe(1);
        expect(metrics.dbOperations.get(['dbmwidget.create', 'ok'])).toBe(1);
        expect(metrics.dbOperations.get(['dbmwidget.find', 'ok'])).toBe(1);
        expect(metrics.dbDuration.count(['dbmwidget.find'])).toBe(1);
    });

    it('counts a failed one as an error', async () => {
        // No tenant: a scoped collection refuses it.
        await expect(broker.call('dbmwidget.create', { label: 'nobody' })).rejects.toThrow();

        expect(metrics.dbOperations.get(['dbmwidget.create', 'error'])).toBe(1);
    });
});
