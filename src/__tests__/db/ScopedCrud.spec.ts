import { z } from 'zod';
import { createTestApp, destroyTestApp, dropTestCollection } from '../helpers/setup.js';
import { MeshApp } from '../../core/MeshApp.js';
import { ServiceModule } from '../../core/ServiceModule.js';
import { defineCrud } from '../../interfaces/ICrudContract.js';
import { IServiceBroker } from '../../interfaces/IServiceBroker.js';
import { MeshError } from '../../core/MeshError.js';

const SiteSchema = z.object({
    host: z.string(),
    tenantId: z.string(),
    app: z.string().optional(),
});

export const siteCrud = defineCrud('site', SiteSchema, {
    scopedBy: 'tenantId',
    dependencies: [],
});

class SiteModule extends ServiceModule {
    public readonly domain = 'site';

    constructor() {
        super();
        this.mountCrud(siteCrud);
    }
}

declare global {
    interface IServiceToolRegistry {
        'site.create': { params: { host: string; tenantId?: string; app?: string }; returns: { id: string; host: string; tenantId: string; app?: string } };
        'site.create_many': { params: Array<{ host: string; tenantId?: string; app?: string }>; returns: Array<{ id: string; host: string; tenantId: string; app?: string }> };
        'site.find': { params: { query?: Record<string, unknown> }; returns: Array<{ id: string; host: string; tenantId: string; app?: string }> };
        'site.find_one': { params: { query?: Record<string, unknown> }; returns: { id: string; host: string; tenantId: string; app?: string } | undefined };
        'site.count': { params: { query?: Record<string, unknown> }; returns: number };
        'site.get': { params: { id: string }; returns: { id: string; host: string; tenantId: string; app?: string } };
        'site.resolve': { params: { id: string }; returns: { id: string; host: string; tenantId: string; app?: string } | undefined };
        'site.update': { params: { id: string; host?: string; tenantId?: string; app?: string }; returns: { id: string; host: string; tenantId: string; app?: string } | undefined };
        'site.replace': { params: { id: string; host: string; tenantId?: string; app?: string }; returns: { id: string; host: string; tenantId: string; app?: string } | undefined };
        'site.delete': { params: { id: string }; returns: { success: boolean } };
    }
}

describe('Scoped CRUD Collections', () => {
    let app: MeshApp;
    let broker: IServiceBroker;

    const acmeMeta = { meta: { user: { id: 'u1', tenant_id: 'acme' } } };
    const betaMeta = { meta: { user: { id: 'u2', tenant_id: 'beta' } } };

    beforeAll(async () => {
        await dropTestCollection('site');
        app = await createTestApp('scoped-crud-node');
        broker = app.getProvider<IServiceBroker>('broker');
        await app.registerModule(new SiteModule());
    });

    afterAll(async () => {
        await destroyTestApp(app);
    });

    beforeEach(async () => {
        await dropTestCollection('site');
    });

    // ─── 1. EVERY read is scoped ─────────────────────────────────────────────

    describe('1. Scoped reads (find, find_one, count, get, resolve)', () => {
        it('confines find to the caller resolved scope', async () => {
            await broker.call('site.create', { host: 'acme-1.com' }, acmeMeta);
            await broker.call('site.create', { host: 'acme-2.com' }, acmeMeta);
            await broker.call('site.create', { host: 'beta-1.com' }, betaMeta);

            const acmeSites = await broker.call('site.find', {}, acmeMeta);
            const betaSites = await broker.call('site.find', {}, betaMeta);

            expect(acmeSites.map(s => s.host).sort()).toEqual(['acme-1.com', 'acme-2.com']);
            expect(betaSites.map(s => s.host)).toEqual(['beta-1.com']);
        });

        it('confines find_one to the caller scope, returning undefined across scope boundaries', async () => {
            await broker.call('site.create', { host: 'shared-host.com' }, betaMeta);

            const acmeFindOne = await broker.call('site.find_one', { query: { host: 'shared-host.com' } }, acmeMeta);
            expect(acmeFindOne).toBeUndefined();

            const betaFindOne = await broker.call('site.find_one', { query: { host: 'shared-host.com' } }, betaMeta);
            expect(betaFindOne).toBeDefined();
            expect(betaFindOne?.host).toBe('shared-host.com');
            expect(betaFindOne?.tenantId).toBe('beta');
        });

        it('confines count to the caller scope', async () => {
            await broker.call('site.create', { host: 'acme-1.com' }, acmeMeta);
            await broker.call('site.create', { host: 'acme-2.com' }, acmeMeta);
            await broker.call('site.create', { host: 'beta-1.com' }, betaMeta);

            const acmeCount = await broker.call('site.count', {}, acmeMeta);
            const betaCount = await broker.call('site.count', {}, betaMeta);

            expect(acmeCount).toBe(2);
            expect(betaCount).toBe(1);
        });

        it('answers NOT FOUND on get for a row belonging to another scope, never forbidden', async () => {
            const betaDoc = await broker.call('site.create', { host: 'secret.beta.com' }, betaMeta);

            // Fetching within beta works
            const ownDoc = await broker.call('site.get', { id: betaDoc.id }, betaMeta);
            expect(ownDoc.id).toBe(betaDoc.id);

            // Fetching across tenant returns 404 NOT_FOUND, never 403 FORBIDDEN
            let caughtError: MeshError | undefined;
            try {
                await broker.call('site.get', { id: betaDoc.id }, acmeMeta);
            } catch (err) {
                if (err instanceof MeshError) {
                    caughtError = err;
                }
            }

            expect(caughtError).toBeDefined();
            expect(caughtError?.status).toBe(404);
            expect(caughtError?.code).toBe('NOT_FOUND');
        });

        it('returns undefined on resolve for a row belonging to another scope', async () => {
            const betaDoc = await broker.call('site.create', { host: 'secret.beta.com' }, betaMeta);

            const ownResolve = await broker.call('site.resolve', { id: betaDoc.id }, betaMeta);
            expect(ownResolve?.id).toBe(betaDoc.id);

            const crossResolve = await broker.call('site.resolve', { id: betaDoc.id }, acmeMeta);
            expect(crossResolve).toBeUndefined();
        });
    });

    // ─── 2. EVERY write is scoped ────────────────────────────────────────────

    describe('2. Scoped writes (update, replace, delete)', () => {
        it('refuses to update a row belonging to another scope, answering NOT FOUND', async () => {
            const betaDoc = await broker.call('site.create', { host: 'beta.com', app: 'v1' }, betaMeta);

            let caughtError: MeshError | undefined;
            try {
                await broker.call(
                    'site.update',
                    { id: betaDoc.id, app: 'v2-hacked' },
                    acmeMeta,
                );
            } catch (err) {
                if (err instanceof MeshError) caughtError = err;
            }

            expect(caughtError).toBeDefined();
            expect(caughtError?.status).toBe(404);
            expect(caughtError?.code).toBe('NOT_FOUND');

            // Verify document unchanged in beta
            const verifyDoc = await broker.call('site.get', { id: betaDoc.id }, betaMeta);
            expect(verifyDoc.app).toBe('v1');
        });

        it('refuses to replace a row belonging to another scope, answering NOT FOUND', async () => {
            const betaDoc = await broker.call('site.create', { host: 'beta.com', app: 'original' }, betaMeta);

            let caughtError: MeshError | undefined;
            try {
                await broker.call(
                    'site.replace',
                    { id: betaDoc.id, host: 'beta-replaced.com', app: 'replaced' },
                    acmeMeta,
                );
            } catch (err) {
                if (err instanceof MeshError) caughtError = err;
            }

            expect(caughtError).toBeDefined();
            expect(caughtError?.status).toBe(404);
            expect(caughtError?.code).toBe('NOT_FOUND');

            const verifyDoc = await broker.call('site.get', { id: betaDoc.id }, betaMeta);
            expect(verifyDoc.host).toBe('beta.com');
            expect(verifyDoc.app).toBe('original');
        });

        it('refuses to delete a row belonging to another scope', async () => {
            const betaDoc = await broker.call('site.create', { host: 'beta.com' }, betaMeta);

            const deleteRes = await broker.call(
                'site.delete',
                { id: betaDoc.id },
                acmeMeta,
            );

            expect(deleteRes.success).toBe(false);

            // Verify row still exists in beta
            const verifyDoc = await broker.call('site.get', { id: betaDoc.id }, betaMeta);
            expect(verifyDoc.id).toBe(betaDoc.id);
        });
    });

    // ─── 3. create sets the field rather than checking it ────────────────────

    describe('3. Create stamps caller scope', () => {
        it('stamps caller resolved scope even when caller names a different tenantId', async () => {
            const doc = await broker.call(
                'site.create',
                { host: 'acme.com', tenantId: 'claimed-someone-else' },
                acmeMeta,
            );

            expect(doc.tenantId).toBe('acme');

            // Verify it exists in acme, not claimed
            const verifyAcme = await broker.call('site.find', {}, acmeMeta);
            expect(verifyAcme.map(s => s.host)).toEqual(['acme.com']);
        });

        it('stamps caller resolved scope when tenantId is omitted by caller', async () => {
            const doc = await broker.call(
                'site.create',
                { host: 'omitted.com' },
                acmeMeta,
            );

            expect(doc.tenantId).toBe('acme');
        });

        it('stamps caller resolved scope on each item in create_many', async () => {
            const docs = await broker.call(
                'site.create_many',
                [
                    { host: 'many-1.com', tenantId: 'foreign-1' },
                    { host: 'many-2.com' },
                ],
                acmeMeta,
            );

            expect(docs).toHaveLength(2);
            expect(docs[0].tenantId).toBe('acme');
            expect(docs[1].tenantId).toBe('acme');
        });
    });

    // ─── 4. A caller with NO scope ───────────────────────────────────────────

    describe('4. Missing caller scope refuses the call', () => {
        it('refuses find when call carries no scope', async () => {
            let error: MeshError | undefined;
            try {
                await broker.call('site.find', {});
            } catch (err) {
                if (err instanceof MeshError) error = err;
            }

            expect(error).toBeDefined();
            expect(error?.status).toBe(401);
            expect(error?.code).toBe('UNAUTHORIZED');
            expect(error?.message).toContain('Scoped collection "site" requires a resolved "tenantId" scope');
        });

        it('refuses create when call carries no scope', async () => {
            let error: MeshError | undefined;
            try {
                await broker.call('site.create', { host: 'orphan.com' });
            } catch (err) {
                if (err instanceof MeshError) error = err;
            }

            expect(error).toBeDefined();
            expect(error?.status).toBe(401);
            expect(error?.code).toBe('UNAUTHORIZED');
        });

        it('refuses get when call carries no scope', async () => {
            let error: MeshError | undefined;
            try {
                await broker.call('site.get', { id: '60c72b2f9b1d8b2bad000001' });
            } catch (err) {
                if (err instanceof MeshError) error = err;
            }

            expect(error).toBeDefined();
            expect(error?.status).toBe(401);
            expect(error?.code).toBe('UNAUTHORIZED');
        });
    });

    // ─── 5. Explicit query naming the scope field ────────────────────────────

    describe('5. Explicit query with scope field: caller scope wins', () => {
        it('overwrites user-supplied query scope with caller resolved scope on find', async () => {
            await broker.call('site.create', { host: 'acme-site.com' }, acmeMeta);
            await broker.call('site.create', { host: 'beta-site.com' }, betaMeta);

            // Caller is acme, but explicitly asks for tenantId: beta
            const results = await broker.call(
                'site.find',
                { query: { tenantId: 'beta' } },
                acmeMeta,
            );

            // Caller scope (acme) wins; cannot widen or switch to beta
            expect(results.map(s => s.host)).toEqual(['acme-site.com']);
        });

        it('overwrites user-supplied query scope with caller resolved scope on count', async () => {
            await broker.call('site.create', { host: 'acme-site.com' }, acmeMeta);
            await broker.call('site.create', { host: 'beta-site.com' }, betaMeta);

            const count = await broker.call(
                'site.count',
                { query: { tenantId: 'beta' } },
                acmeMeta,
            );

            // Count is for acme (1), not beta
            expect(count).toBe(1);
        });
    });

    // ─── 6. Internal callers ─────────────────────────────────────────────────

    describe('6. Internal callers without meta.user', () => {
        it('refuses broker calls that have no user and no tenant context', async () => {
            let error: MeshError | undefined;
            try {
                // An internal service calling without meta
                await broker.call('site.find', {}, { meta: {} });
            } catch (err) {
                if (err instanceof MeshError) error = err;
            }

            expect(error).toBeDefined();
            expect(error?.status).toBe(401);
            expect(error?.code).toBe('UNAUTHORIZED');
        });

        it('allows internal callers using direct tenant_id association on meta', async () => {
            // Direct tenant association on IMeshMeta without user
            const internalMeta = { meta: { tenant_id: 'acme' } };

            await broker.call('site.create', { host: 'internal-created.com' }, internalMeta);

            const found = await broker.call('site.find', {}, internalMeta);
            expect(found.map(s => s.host)).toEqual(['internal-created.com']);
            expect(found[0].tenantId).toBe('acme');
        });
    });
});
