import { z } from 'zod';
import { createTestApp, destroyTestApp, dropTestCollection } from '../helpers/setup.js';
import { MeshApp } from '../../core/MeshApp.js';
import { defineCrud } from '../../interfaces/ICrudContract.js';
import { IServiceBroker } from '../../interfaces/IServiceBroker.js';
import { Database } from '../../db/Database.js';

const ProviderSchema = z.object({
    name: z.string(),
    apiKey: z.string(),
});

export const providerCrud = defineCrud('hiddenprovider', ProviderSchema, {
    hidden: ['apiKey'],
    dependencies: [], filePath: 'src/__tests__/db/HiddenFields.spec.ts', permissions: [],
});

declare global {
    interface IServiceToolRegistry {
        'hiddenprovider.create': { params: { name: string; apiKey: string }; returns: { id: string; name: string; apiKey?: string } };
        'hiddenprovider.find': { params: { query?: Record<string, unknown> }; returns: Array<{ id: string; name: string; apiKey?: string }> };
        'hiddenprovider.get': { params: { id: string }; returns: { id: string; name: string; apiKey?: string } };
        'hiddenprovider.update': { params: { id: string; name?: string; apiKey?: string }; returns: { id: string; name: string; apiKey?: string } | undefined };
    }
    // The real generator (mesh-serve's GenerateCommand) derives this from `providerCrud['outputSchema']`
    // by static analysis; declared by hand here for the same reason IServiceToolRegistry is above --
    // this package has no generator of its own to run. `apiKey` is required, not optional, matching
    // `outputSchema` (the full, undecorated schema `defineCrud` builds from `ProviderSchema` -- not
    // `publicOutputSchema`, which is what would be optional if hidden fields were ever stripped there).
    interface IServiceCollectionRegistry {
        'hiddenprovider': { id: string; name: string; apiKey: string; createdAt: Date; updatedAt: Date };
    }
}

describe('defineCrud: hidden fields', () => {
    let app: MeshApp;
    let broker: IServiceBroker;

    beforeAll(async () => {
        await dropTestCollection('hiddenprovider');
        app = await createTestApp('hidden-fields-node');
        broker = app.getProvider<IServiceBroker>('broker');
        broker.registerCrud(providerCrud);
    });

    afterAll(async () => {
        await destroyTestApp(app);
    });

    beforeEach(async () => {
        await dropTestCollection('hiddenprovider');
    });

    it('rejects a hidden field that is not on the base schema', () => {
        expect(() => defineCrud('bad', ProviderSchema, { hidden: ['nope' as never], dependencies: [], filePath: 'src/__tests__/db/HiddenFields.spec.ts', permissions: [] }))
            .toThrow(/hidden field "nope" is not defined/);
    });

    it('rejects id/createdAt/updatedAt as hidden -- structural, not data', () => {
        expect(() => defineCrud('bad2', ProviderSchema, { hidden: ['createdAt' as never], dependencies: [], filePath: 'src/__tests__/db/HiddenFields.spec.ts', permissions: [] }))
            .toThrow(/cannot be declared hidden/);
    });

    it('create never returns the hidden field', async () => {
        const created = await broker.call('hiddenprovider.create', { name: 'registrar-a', apiKey: 'secret-123' });
        expect(created.name).toBe('registrar-a');
        expect(created.apiKey).toBeUndefined();
    });

    it('find and get never return the hidden field, even though it was written', async () => {
        await broker.call('hiddenprovider.create', { name: 'registrar-b', apiKey: 'secret-456' });

        const found = await broker.call('hiddenprovider.find', {});
        expect(found).toHaveLength(1);
        expect(found[0]!.apiKey).toBeUndefined();

        const got = await broker.call('hiddenprovider.get', { id: found[0]!.id });
        expect(got.apiKey).toBeUndefined();
    });

    it('update never returns the hidden field, even when the update writes it', async () => {
        const created = await broker.call('hiddenprovider.create', { name: 'registrar-c', apiKey: 'secret-789' });
        const updated = await broker.call('hiddenprovider.update', { id: created.id, apiKey: 'rotated-secret' });
        expect(updated?.apiKey).toBeUndefined();
    });

    it('the value is actually persisted -- a caller with its own full schema can read it back', async () => {
        const created = await broker.call('hiddenprovider.create', { name: 'registrar-d', apiKey: 'secret-real' });

        const db = app.getProvider<Database>('db');
        const fullRepo = db.repo(providerCrud.outputSchema, 'hiddenprovider');
        const raw = await fullRepo.get(created.id);
        expect(raw?.apiKey).toBe('secret-real');
    });

    it('database.collection() reads the same full row -- typed off the real registered defineCrud, not a schema passed by hand', async () => {
        const created = await broker.call('hiddenprovider.create', { name: 'registrar-f', apiKey: 'secret-collection' });

        const db = app.getProvider<Database>('db');
        const repo = db.collection('hiddenprovider');
        const raw = await repo.get(created.id);
        // Not `?.` -- IServiceCollectionRegistry declares apiKey required, so this line itself is the
        // compile-time proof: if collection()'s runtime schema (outputSchema) ever drifted from what
        // the type declares, this would still compile (the mismatch is only checkable by the cast at
        // Database.collection()'s own boundary), but a wrong *value* here would fail the assertion --
        // the two checks together are what "no sideload" actually means: sound types, verified values.
        expect(raw!.apiKey).toBe('secret-collection');
        expect(raw!.name).toBe('registrar-f');
    });

    it('data.created and the named event never carry the hidden field', async () => {
        const genericEvents: unknown[] = [];
        const namedEvents: unknown[] = [];
        broker.on('data.created', (payload) => genericEvents.push(payload));
        broker.on('hiddenprovider.created' as never, (payload) => namedEvents.push(payload));

        await broker.call('hiddenprovider.create', { name: 'registrar-e', apiKey: 'secret-event' });

        expect(genericEvents).toHaveLength(1);
        expect((genericEvents[0] as { item: { apiKey?: string } }).item.apiKey).toBeUndefined();
        expect(namedEvents).toHaveLength(1);
        expect((namedEvents[0] as { apiKey?: string }).apiKey).toBeUndefined();
    });

    it('publicOutputSchema omits the hidden field; outputSchema and baseSchema still declare it', () => {
        expect(providerCrud.publicOutputSchema.shape.apiKey).toBeUndefined();
        expect(providerCrud.outputSchema.shape.apiKey).toBeDefined();
        expect(providerCrud.baseSchema.shape.apiKey).toBeDefined();
    });
});
