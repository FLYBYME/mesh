import { z } from 'zod';
import { createTestApp, destroyTestApp, dropTestCollection } from '../helpers/setup.js';
import { MeshApp } from '../../core/MeshApp.js';
import { ServiceBroker } from '../../core/ServiceBroker.js';
import { defineCrud } from '../../interfaces/ICrudContract.js';
import { defineContract, defaultPrint } from '../../interfaces/IToolContract.js';
import type { IServiceBroker } from '../../interfaces/IServiceBroker.js';

/**
 * A complete service with no `ServiceModule` anywhere: a CRUD collection, a before/after hook pair,
 * a custom tool, and an event subscriber -- every piece registered standalone. This is what
 * "`ServiceModule` is dropped" (docs/CONTRACT_DRIVEN_PLACEMENT.md) requires in practice, since
 * `mountCrud`/`mountCrudHook`/`mountEventHandler` were the three things a service could not
 * previously do without the class.
 */

const WidgetSchema = z.object({
    label: z.string(),
    tenantId: z.string(),
});

export const widgetCrud = defineCrud('standalonewidget', WidgetSchema, {
    scopedBy: 'tenantId',
    dependencies: [], filePath: 'src/__tests__/db/StandaloneCrud.spec.ts', permissions: [],
});

const countInput = z.object({});
const countOutput = z.object({ total: z.number() });

const countContract = defineContract({
    domain: 'standalonewidget',
    action: 'labelled',
    description: 'A custom tool alongside the standalone CRUD, sharing its domain.',
    inputSchema: countInput,
    outputSchema: countOutput,
    rest: { method: 'GET', path: '/standalonewidget/labelled' },
    filePath: 'src/__tests__/db/StandaloneCrud.spec.ts',
    concurrency: 'on-demand',
    permissions: [],
    print: defaultPrint,
});

declare global {
    interface IServiceToolRegistry {
        'standalonewidget.create': { params: { label: string; tenantId?: string }; returns: { id: string; label: string; tenantId: string } };
        'standalonewidget.find': { params: { query?: Record<string, unknown> }; returns: Array<{ id: string; label: string; tenantId: string }> };
        'standalonewidget.get': { params: { id: string }; returns: { id: string; label: string; tenantId: string } };
        'standalonewidget.labelled': { params: {}; returns: { total: number } };
    }
    interface IServiceCollectionRegistry {
        'standalonewidget': { id: string; label: string; tenantId: string; createdAt: Date; updatedAt: Date };
    }
}

describe('a whole service, standalone (no ServiceModule)', () => {
    let app: MeshApp;
    let broker: ServiceBroker;
    const acme = { meta: { user: { id: 'u1', tenant_id: 'acme' } } };

    const beforeSeen: unknown[] = [];
    const afterSeen: unknown[] = [];
    const eventsSeen: unknown[] = [];

    beforeAll(async () => {
        await dropTestCollection('standalonewidget');
        app = await createTestApp('standalone-crud-node');
        broker = app.getProvider<IServiceBroker>('broker') as ServiceBroker;

        // The whole service, registered without a class.
        broker.registerCrud(widgetCrud, {
            hooks: {
                create: {
                    before: async (input, ctx) => {
                        beforeSeen.push({ input, caller: ctx.meta?.user?.id });
                        const record = input as { label: string };
                        return { ...record, label: record.label.toUpperCase() };
                    },
                },
                find: {
                    after: async (output) => {
                        afterSeen.push(output);
                        return output;
                    },
                },
            },
        });

        broker.registerContract(countContract, async (_input, ctx) => {
            const rows = await ctx.db('standalonewidget').find({ query: {} });
            return { total: rows.length };
        });

        broker.registerEventHandler('standalonewidget.created' as never, ((payload: unknown) => {
            eventsSeen.push(payload);
        }) as never);
    });

    afterAll(async () => {
        await destroyTestApp(app);
    });

    beforeEach(async () => {
        await dropTestCollection('standalonewidget');
        beforeSeen.length = 0;
        afterSeen.length = 0;
        eventsSeen.length = 0;
    });

    it('serves CRUD with no module mounted for the domain at all', async () => {
        expect(broker.getModule('standalonewidget')).toBeUndefined();

        const created = await broker.call('standalonewidget.create', { label: 'first' }, acme);
        expect(created.id).toBeTruthy();

        const found = await broker.call('standalonewidget.find', {}, acme);
        expect(found).toHaveLength(1);
    });

    it('runs a standalone beforeCrud hook -- and it can actually rewrite the input', async () => {
        const created = await broker.call('standalonewidget.create', { label: 'quiet' }, acme);

        // The hook upper-cased it on the way in, so this proves the rewrite reached the database,
        // not just that the hook was called.
        expect(created.label).toBe('QUIET');
        expect(beforeSeen).toHaveLength(1);
        expect((beforeSeen[0] as { caller: string }).caller).toBe('u1');
    });

    it('runs a standalone afterCrud hook', async () => {
        await broker.call('standalonewidget.create', { label: 'a' }, acme);
        await broker.call('standalonewidget.find', {}, acme);
        expect(afterSeen).toHaveLength(1);
    });

    it('still applies scopedBy isolation -- standalone registration does not opt out of it', async () => {
        await broker.call('standalonewidget.create', { label: 'acme-only' }, acme);

        const other = { meta: { user: { id: 'u2', tenant_id: 'beta' } } };
        const beta = await broker.call('standalonewidget.find', {}, other);
        expect(beta).toHaveLength(0);

        const mine = await broker.call('standalonewidget.find', {}, acme);
        expect(mine).toHaveLength(1);
        expect(mine[0].tenantId).toBe('acme');
    });

    it('delivers CRUD events to a standalone event subscriber', async () => {
        await broker.call('standalonewidget.create', { label: 'evented' }, acme);
        // Emission is synchronous into localEvents; the handler itself is fire-and-forget.
        await new Promise((r) => setTimeout(r, 20));
        expect(eventsSeen).toHaveLength(1);
    });

    it('lets a standalone custom tool sit alongside the standalone CRUD on the same domain', async () => {
        await broker.call('standalonewidget.create', { label: 'x' }, acme);
        await broker.call('standalonewidget.create', { label: 'y' }, acme);

        const result = await broker.call('standalonewidget.labelled', {}, acme);
        expect(result.total).toBe(2);
    });
});
