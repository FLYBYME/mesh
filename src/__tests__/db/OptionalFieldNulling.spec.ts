import { z } from 'zod';
import { createTestApp, destroyTestApp, dropTestCollection } from '../helpers/setup.js';
import { MeshApp } from '../../core/MeshApp.js';
import { defineCrud } from '../../interfaces/ICrudContract.js';
import { IServiceBroker } from '../../interfaces/IServiceBroker.js';
import { Database } from '../../db/Database.js';

const NoteSchema = z.object({
    title: z.string(),
    tag: z.string().optional(),
});

export const noteCrud = defineCrud('note', NoteSchema, { dependencies: [], filePath: 'src/__tests__/db/OptionalFieldNulling.spec.ts', permissions: [] });

declare global {
    interface IServiceToolRegistry {
        'note.create': { params: { title: string; tag?: string }; returns: { id: string; title: string; tag?: string } };
        'note.update': { params: { id: string; title?: string; tag?: string }; returns: { id: string; title: string; tag?: string } | undefined };
        'note.get': { params: { id: string }; returns: { id: string; title: string; tag?: string } };
    }
}

/**
 * Regression for a real bug: Database's own MongoClient defaulted to BSON-encoding an `undefined`
 * property as `null` rather than omitting it, so any `.optional()` field left unset at create time
 * silently became `null` in Mongo -- invisible until read back and re-parsed against its own schema
 * (`.optional()` allows `undefined`, never `null`). Found via serve.hold's `reason` field failing to
 * re-parse after a decide() that never set it.
 */
describe('an unset optional field never becomes a stored null', () => {
    let app: MeshApp;
    let broker: IServiceBroker;

    beforeAll(async () => {
        await dropTestCollection('note');
        app = await createTestApp('optional-field-nulling-node');
        broker = app.getProvider<IServiceBroker>('broker');
        broker.registerCrud(noteCrud);
    });

    afterAll(async () => {
        await destroyTestApp(app);
    });

    it('create leaves an unset optional field absent, not null, in the raw stored document', async () => {
        const created = await broker.call('note.create', { title: 'first' });
        expect(created.tag).toBeUndefined();

        const db = app.getProvider<Database>('db');
        const raw = await db.repo(noteCrud.outputSchema, 'note').get(created.id);
        expect(raw?.tag).toBeUndefined();
        expect('tag' in (raw as object)).toBe(false);
    });

    it('an update that never touches the field does not turn it into a stored null, and the row still re-parses cleanly', async () => {
        const created = await broker.call('note.create', { title: 'second' });
        const updated = await broker.call('note.update', { id: created.id, title: 'second, edited' });
        expect(updated?.tag).toBeUndefined();

        // The real proof: re-fetching after the update must not throw a Zod error for `tag` being
        // `null` -- that ZodError, not a wrong value, was the actual shape of the bug.
        const refetched = await broker.call('note.get', { id: created.id });
        expect(refetched.tag).toBeUndefined();
    });
});
