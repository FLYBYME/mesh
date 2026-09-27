import { z } from 'zod';
import { createTestApp, destroyTestApp, dropTestCollection } from '../helpers/setup.js';
import { MeshApp } from '../../core/MeshApp.js';
import { defineCrud } from '../../interfaces/ICrudContract.js';
import { IServiceBroker } from '../../interfaces/IServiceBroker.js';
import type { IMeshPacket } from '../../interfaces/IMeshNetwork.js';

const ShelfSchema = z.object({
    name: z.string(),
    items: z.array(z.object({ label: z.string() })).default([]),
});

export const shelfCrud = defineCrud('shelf', ShelfSchema, { dependencies: [], filePath: 'src/__tests__/db/UpdateValidatesInput.spec.ts', permissions: [] });

declare global {
    interface IServiceToolRegistry {
        'shelf.create': { params: { name: string; items?: { label: string }[] }; returns: { id: string; name: string; items: { label: string }[] } };
        'shelf.update': { params: { id: string; name?: string; items?: unknown }; returns: { id: string; name: string; items: { label: string }[] } | undefined };
        'shelf.find': { params: Record<string, unknown>; returns: { id: string; name: string; items: { label: string }[] }[] };
    }
}

/**
 * A CLI flag once sent `containers: [[{...}]]` to processGroup.update; it was stored, and every
 * later find of that collection failed to parse (2026-09-27). An update the schema rejects must be
 * refused before it is written.
 */
describe('update refuses input its own schema rejects', () => {
    let app: MeshApp;
    let broker: IServiceBroker;

    beforeAll(async () => {
        await dropTestCollection('shelf');
        app = await createTestApp('update-validates-input-node');
        broker = app.getProvider<IServiceBroker>('broker');
        broker.registerCrud(shelfCrud);
    });

    afterAll(async () => {
        await destroyTestApp(app);
    });

    it('refuses a nested array for an array of objects, and the collection stays readable', async () => {
        const created = await broker.call('shelf.create', { name: 'a', items: [{ label: 'x' }] });
        await expect(broker.call('shelf.update', { id: created.id, items: [[{ label: 'y' }]] })).rejects.toThrow();
        const rows = await broker.call('shelf.find', {});
        expect(rows.find((r) => r.id === created.id)?.items).toEqual([{ label: 'x' }]);
    });

    it('refuses it on a call that arrived over the network too -- nothing written', async () => {
        const created = await broker.call('shelf.create', { name: 'b', items: [{ label: 'x' }] });
        const packet: IMeshPacket = {
            id: 'remote-1', topic: 'shelf.update', type: 'REQUEST', senderNodeID: 'api-node', timestamp: Date.now(),
            data: { id: created.id, items: [[{ label: 'y' }]] }, meta: {},
        };
        const incoming = broker.handleIncomingRPC(packet);
        await expect(incoming).rejects.toThrow(/Invalid params for tool shelf.update/);
        const rows = await broker.call('shelf.find', {});
        expect(rows.find((r) => r.id === created.id)?.items).toEqual([{ label: 'x' }]);
    });
});
