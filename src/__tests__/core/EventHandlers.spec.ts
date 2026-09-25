import { z } from 'zod';
import { createTestApp, destroyTestApp, dropTestCollection } from '../helpers/setup.js';
import { MeshApp } from '../../core/MeshApp.js';
import { ServiceBroker } from '../../core/ServiceBroker.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { NetworkModule } from '../../modules/NetworkModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { WSTransport } from '../../transports/node/WSTransport.js';
import { JSONSerializer } from '../../serializers/JSONSerializer.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { defineCrud } from '../../interfaces/ICrudContract.js';
import { defineEvent } from '../../interfaces/IEventContract.js';
import { defineEventHandler } from '../../interfaces/IEventHandler.js';
import { defineContract, defaultPrint } from '../../interfaces/IToolContract.js';
import type { IServiceBroker } from '../../interfaces/IServiceBroker.js';
import type { IServiceContext } from '../../interfaces/IServiceContext.js';
import { eventScope, scopeOfOccurrence } from '../../core/EventScope.js';

/**
 * Event handlers after `ServiceModule`: declared (`defineEventHandler`), delivered `'each'` or
 * `'one'`, given the tenant the event belongs to, and removable -- one at a time, or everything a
 * part registered at once (`withOwner` / `unregisterOwner`).
 *
 * What this replaces: `registerEventHandler(name, fn)` could only add. Nothing ever unsubscribed a
 * handler, so a part reloaded in place (how every deploy works) kept its old handlers running beside
 * its new ones; a handler's ctx was an untyped record with no `signal`, cast to fit, whose `meta`
 * named no tenant for an event from another node; and every node ran every handler.
 */

const GadgetSchema = z.object({ label: z.string(), tenantId: z.string() });
const gadgetCrud = defineCrud('evgadget', GadgetSchema, {
    scopedBy: 'tenantId',
    dependencies: [], filePath: 'src/__tests__/core/EventHandlers.spec.ts', permissions: [],
});

const pingEvent = defineEvent('evtest.ping', z.object({ n: z.number() }), { scopedBy: 'global' });
const unscopedEvent = defineEvent('evtest.unscoped', z.object({ n: z.number() }));

const whereContract = defineContract({
    domain: 'evleader',
    action: 'where',
    description: 'Gives the evleader domain something to advertise, so it has a leader.',
    inputSchema: z.object({}),
    outputSchema: z.object({ nodeID: z.string() }),
    rest: { method: 'GET', path: '/evleader/where' },
    filePath: 'src/__tests__/core/EventHandlers.spec.ts',
    concurrency: 'on-demand',
    permissions: [],
    print: defaultPrint,
});

declare global {
    interface IServiceToolRegistry {
        'evgadget.create': { params: { label: string; tenantId?: string }; returns: { id: string; label: string; tenantId: string } };
        'evgadget.delete': { params: { id: string }; returns: { success: boolean } };
        'evleader.where': { params: Record<string, never>; returns: { nodeID: string } };
    }
    interface IServiceCollectionRegistry {
        'evgadget': { id: string; label: string; tenantId: string; createdAt: Date; updatedAt: Date };
    }
    interface EventRegistry {
        'evgadget.created': { id: string; label: string; tenantId: string };
        'evgadget.deleted': { id: string; tenantId?: string };
        'evtest.ping': z.infer<typeof pingEvent.schema>;
        'evtest.unscoped': z.infer<typeof unscopedEvent.schema>;
    }
}

const settle = (ms = 100): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('event scope, read from the event definition', () => {
    it('knows where each CRUD verb carries its scope, including a delete', () => {
        expect(eventScope('evgadget.created')).toEqual({ scopedBy: 'tenantId' });
        expect(eventScope('evgadget.updated')).toEqual({ scopedBy: 'item.tenantId' });
        expect(eventScope('evgadget.deleted')).toEqual({ scopedBy: 'tenantId' });
    });

    it('delivers a declared-global event to everyone, and an unscoped one to nobody', () => {
        expect(scopeOfOccurrence('evtest.ping', { n: 1 })).toEqual({ global: true });
        expect(scopeOfOccurrence('evtest.unscoped', { n: 1 })).toBeUndefined();
        expect(eventScope('evtest.unscoped')).toEqual({ refusal: expect.stringContaining('no scopedBy') });
        expect(eventScope('nobody.defines.this')).toBeUndefined();
    });

    it('reads a missing or non-string scope as nobody, never as everybody', () => {
        expect(scopeOfOccurrence('evgadget.created', { id: 'x' })).toBeUndefined();
        expect(scopeOfOccurrence('evgadget.created', { id: 'x', tenantId: 7 })).toBeUndefined();
        expect(scopeOfOccurrence('evgadget.created', { id: 'x', tenantId: 'acme' })).toEqual({ scope: 'acme' });
    });
});

describe('declared event handlers on one node', () => {
    let app: MeshApp;
    let broker: ServiceBroker;
    const acme = { meta: { user: { id: 'u1', tenant_id: 'acme' } } };

    beforeAll(async () => {
        await dropTestCollection('evgadget');
        app = await createTestApp('event-handlers-node');
        broker = app.getProvider<ServiceBroker>('broker');
        broker.registerCrud(gadgetCrud);
    });

    afterAll(async () => {
        await destroyTestApp(app);
    });

    beforeEach(async () => {
        await dropTestCollection('evgadget');
    });

    it('gives a handler the tenant its event belongs to, so ctx.db acts for that tenant', async () => {
        const seen: Array<{ tenant: unknown; visible: number }> = [];
        const unsubscribe = broker.registerEventHandler(
            defineEventHandler({ event: 'evgadget.created', domain: 'evgadget', delivery: 'each', description: 'test' }),
            async (_payload, ctx) => {
                // No meta was passed anywhere -- the tenant comes from the event itself.
                const rows = await ctx.db('evgadget').find({ query: {} });
                seen.push({ tenant: ctx.meta?.tenant_id, visible: rows.length });
            },
        );

        await broker.call('evgadget.create', { label: 'one' }, acme);
        await settle();
        unsubscribe();

        expect(seen).toEqual([{ tenant: 'acme', visible: 1 }]);
    });

    it('carries the owning tenant on a scoped delete', async () => {
        const deletes: Array<{ payload: unknown; tenant: unknown }> = [];
        const unsubscribe = broker.registerEventHandler(
            defineEventHandler({ event: 'evgadget.deleted', domain: 'evgadget', delivery: 'each', description: 'test' }),
            (payload, ctx) => { deletes.push({ payload, tenant: ctx.meta?.tenant_id }); },
        );

        const created = await broker.call('evgadget.create', { label: 'doomed' }, acme);
        await broker.call('evgadget.delete', { id: created.id }, acme);
        await settle();
        unsubscribe();

        expect(deletes).toEqual([{ payload: { id: created.id, tenantId: 'acme' }, tenant: 'acme' }]);
    });

    it('stops delivering once unsubscribed, and aborts the handler\'s signal', async () => {
        let calls = 0;
        let signal: AbortSignal | undefined;
        const unsubscribe = broker.registerEventHandler(
            defineEventHandler({ event: 'evtest.ping', domain: 'evleader', delivery: 'each', description: 'test' }),
            (_payload, ctx: IServiceContext) => { calls++; signal = ctx.signal; },
        );

        broker.emit('evtest.ping', { n: 1 }, { skipNetwork: true });
        await settle();
        unsubscribe();
        broker.emit('evtest.ping', { n: 2 }, { skipNetwork: true });
        await settle();

        expect(calls).toBe(1);
        expect(signal?.aborted).toBe(true);
    });

    it('unregisterOwner removes everything a scope registered -- even after an await', async () => {
        let handled = 0;
        await broker.withOwner('part:gadget-extras@v1', async () => {
            await settle(10);
            broker.registerContract(whereContract, async (_input, ctx) => ({ nodeID: ctx.nodeID }));
            broker.registerCrudHook('evgadget', 'create', { before: async (input) => input });
            broker.registerEventHandler(
                defineEventHandler({ event: 'evtest.ping', domain: 'evleader', delivery: 'each', description: 'test' }),
                () => { handled++; },
            );
        });

        expect(broker.getCrudHooks('evgadget', 'create')).toBeDefined();
        await expect(broker.call('evleader.where', {})).resolves.toEqual({ nodeID: 'event-handlers-node' });

        broker.unregisterOwner('part:gadget-extras@v1');

        broker.emit('evtest.ping', { n: 1 }, { skipNetwork: true });
        await settle();
        expect(handled).toBe(0);
        expect(broker.getCrudHooks('evgadget', 'create')).toBeUndefined();
        await expect(broker.call('evleader.where', {})).rejects.toThrow();
    });

    it('does not let an owner remove a contract someone else has since replaced', async () => {
        broker.withOwner('part:old', () => {
            broker.registerContract(whereContract, async () => ({ nodeID: 'old' }));
        });
        broker.withOwner('part:new', () => {
            broker.registerContract(whereContract, async () => ({ nodeID: 'new' }), { replace: true });
        });

        broker.unregisterOwner('part:old');
        await expect(broker.call('evleader.where', {})).resolves.toEqual({ nodeID: 'new' });

        broker.unregisterOwner('part:new');
        await expect(broker.call('evleader.where', {})).rejects.toThrow();
    });
});

describe('event handler delivery across two nodes', () => {
    let appA: MeshApp;
    let appB: MeshApp;
    const logger = new Logger(LogLevel.ERROR);
    const serializer = new JSONSerializer();
    const ran: Record<'each' | 'one', string[]> = { each: [], one: [] };

    const start = async (nodeID: string, port: number, bootstrap?: string): Promise<MeshApp> => {
        const app = new MeshApp({ nodeID, logger });
        app.use(new RegistryModule());
        app.use(new NetworkModule({
            port,
            transports: [new WSTransport(serializer, port, '127.0.0.1')],
            ...(bootstrap !== undefined ? { bootstrapNodes: [bootstrap] } : {}),
        }));
        app.use(new BrokerModule());
        await app.start();

        const broker = app.getProvider<IServiceBroker>('broker');
        broker.registerContract(whereContract, async (_input, ctx) => ({ nodeID: ctx.nodeID }));
        for (const delivery of ['each', 'one'] as const) {
            broker.registerEventHandler(
                defineEventHandler({ event: 'evtest.ping', domain: 'evleader', delivery, description: 'test' }),
                (_payload, ctx) => { ran[delivery].push(ctx.nodeID); },
            );
        }
        return app;
    };

    beforeAll(async () => {
        appA = await start('evdelivery-node-a', 6541);
        appB = await start('evdelivery-node-b', 6542, 'ws://127.0.0.1:6541');
        await settle(800);
    });

    afterAll(async () => {
        await appB?.stop();
        await appA?.stop();
    });

    it("runs 'each' on every node and 'one' on the domain's leader only", async () => {
        appA.getProvider<IServiceBroker>('broker').emit('evtest.ping', { n: 1 });
        await settle(300);

        expect([...ran.each].sort()).toEqual(['evdelivery-node-a', 'evdelivery-node-b']);
        const leader = appA.getProvider<ServiceBroker>('broker').registry.leaderFor('evleader');
        expect(ran.one).toEqual([leader?.nodeID]);
    });
});
