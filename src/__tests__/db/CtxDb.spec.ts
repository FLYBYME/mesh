import { z } from 'zod';
import { createTestApp, destroyTestApp, dropTestCollection } from '../helpers/setup.js';
import { MeshApp } from '../../core/MeshApp.js';
import { defineCrud } from '../../interfaces/ICrudContract.js';
import { defineContract, defaultPrint } from '../../interfaces/IToolContract.js';
import { IServiceBroker } from '../../interfaces/IServiceBroker.js';
import { MeshError } from '../../core/MeshError.js';

/**
 * Proves `ctx.db(domain)` is behaviorally identical to `ctx.call('domain.action', ...)`, not just
 * type-compatible with it -- both routed through the exact same `CrudExecutor`. A scoped collection
 * (`ctxdbsite`, `scopedBy: 'tenantId'`) and a hidden-fields collection (`ctxdbsecret`, `hidden:
 * ['apiKey']`) each get one custom tool whose handler calls `ctx.db(...)` directly and hands the raw
 * result back, so this test can assert it against the equivalent `broker.call()`.
 */

const SiteSchema = z.object({
    host: z.string(),
    tenantId: z.string(),
});

export const ctxDbSiteCrud = defineCrud('ctxdbsite', SiteSchema, {
    scopedBy: 'tenantId',
    dependencies: [], filePath: 'src/__tests__/db/CtxDb.spec.ts', permissions: [],
});

const SecretSchema = z.object({
    name: z.string(),
    apiKey: z.string(),
});

export const ctxDbSecretCrud = defineCrud('ctxdbsecret', SecretSchema, {
    hidden: ['apiKey'],
    dependencies: [], filePath: 'src/__tests__/db/CtxDb.spec.ts', permissions: [],
});

const viaDbFindInput = z.object({});
const viaDbFindOutput = z.array(z.object({ id: z.string(), host: z.string(), tenantId: z.string() }));

const viaDbFindContract = defineContract({
    domain: 'ctxdbsite', action: 'viaDbFind',
    description: 'Calls ctx.db(\'ctxdbsite\').find({}) directly, for comparison against site.find.',
    inputSchema: viaDbFindInput, outputSchema: viaDbFindOutput,
    rest: { method: 'GET', path: '/ctxdbsite/viaDbFind' },
    filePath: 'src/__tests__/db/CtxDb.spec.ts', concurrency: 'on-demand', permissions: [],
    print: defaultPrint,
});

const viaDbGetInput = z.object({ id: z.string() });
const viaDbGetOutput = z.object({ id: z.string(), host: z.string(), tenantId: z.string() });

const viaDbGetContract = defineContract({
    domain: 'ctxdbsite', action: 'viaDbGet',
    description: 'Calls ctx.db(\'ctxdbsite\').get({id}) directly, for comparison against site.get.',
    inputSchema: viaDbGetInput, outputSchema: viaDbGetOutput,
    rest: { method: 'GET', path: '/ctxdbsite/viaDbGet' },
    filePath: 'src/__tests__/db/CtxDb.spec.ts', concurrency: 'on-demand', permissions: [],
    print: defaultPrint,
});

const viaDbFindAsInput = z.object({ asTenant: z.string() });

const viaDbFindAsContract = defineContract({
    domain: 'ctxdbsite', action: 'viaDbFindAs',
    description: 'Calls ctx.db(\'ctxdbsite\', { user: { tenant_id: asTenant } }).find({}) -- an explicit scope override, deliberately different from the caller\'s own ambient ctx.meta.',
    inputSchema: viaDbFindAsInput, outputSchema: viaDbFindOutput,
    rest: { method: 'GET', path: '/ctxdbsite/viaDbFindAs' },
    filePath: 'src/__tests__/db/CtxDb.spec.ts', concurrency: 'on-demand', permissions: [],
    print: defaultPrint,
});

const viaDbSecretGetInput = z.object({ id: z.string() });
const viaDbSecretGetOutput = z.object({ id: z.string(), name: z.string(), apiKey: z.string().optional() });

const viaDbSecretGetContract = defineContract({
    domain: 'ctxdbsecret', action: 'viaDbGet',
    description: 'Calls ctx.db(\'ctxdbsecret\').get({id}) directly, for comparison against ctxdbsecret.get.',
    inputSchema: viaDbSecretGetInput, outputSchema: viaDbSecretGetOutput,
    rest: { method: 'GET', path: '/ctxdbsecret/viaDbGet' },
    filePath: 'src/__tests__/db/CtxDb.spec.ts', concurrency: 'on-demand', permissions: [],
    print: defaultPrint,
});

function registerCtxDbSite(broker: IServiceBroker): void {
    broker.registerCrud(ctxDbSiteCrud);
    broker.registerContract(viaDbFindContract, async (_input, ctx) => ctx.db('ctxdbsite').find({}));
    broker.registerContract(viaDbGetContract, async (input, ctx) => ctx.db('ctxdbsite').get(input));
    broker.registerContract(viaDbFindAsContract, async (input, ctx) => ctx.db('ctxdbsite', { user: { tenant_id: input.asTenant } }).find({}));
}

function registerCtxDbSecret(broker: IServiceBroker): void {
    broker.registerCrud(ctxDbSecretCrud);
    broker.registerContract(viaDbSecretGetContract, async (input, ctx) => ctx.db('ctxdbsecret').get(input));
}

declare global {
    interface IServiceToolRegistry {
        'ctxdbsite.create': { params: { host: string; tenantId?: string }; returns: { id: string; host: string; tenantId: string } };
        'ctxdbsite.find': { params: { query?: Record<string, unknown> }; returns: Array<{ id: string; host: string; tenantId: string }> };
        'ctxdbsite.get': { params: { id: string }; returns: { id: string; host: string; tenantId: string } };
        'ctxdbsite.viaDbFind': { params: {}; returns: Array<{ id: string; host: string; tenantId: string }> };
        'ctxdbsite.viaDbGet': { params: { id: string }; returns: { id: string; host: string; tenantId: string } };
        'ctxdbsite.viaDbFindAs': { params: { asTenant: string }; returns: Array<{ id: string; host: string; tenantId: string }> };
        'ctxdbsecret.create': { params: { name: string; apiKey: string }; returns: { id: string; name: string; apiKey?: string } };
        'ctxdbsecret.get': { params: { id: string }; returns: { id: string; name: string; apiKey?: string } };
        'ctxdbsecret.viaDbGet': { params: { id: string }; returns: { id: string; name: string; apiKey?: string } };
    }
    interface IServiceCollectionRegistry {
        'ctxdbsite': { id: string; host: string; tenantId: string; createdAt: Date; updatedAt: Date };
        'ctxdbsecret': { id: string; name: string; apiKey: string; createdAt: Date; updatedAt: Date };
    }
}

describe('ctx.db() matches ctx.call() exactly', () => {
    let app: MeshApp;
    let broker: IServiceBroker;

    const acmeMeta = { meta: { user: { id: 'u1', tenant_id: 'acme' } } };
    const betaMeta = { meta: { user: { id: 'u2', tenant_id: 'beta' } } };

    beforeAll(async () => {
        await dropTestCollection('ctxdbsite');
        await dropTestCollection('ctxdbsecret');
        app = await createTestApp('ctx-db-node');
        broker = app.getProvider<IServiceBroker>('broker');
        registerCtxDbSite(broker);
        registerCtxDbSecret(broker);
    });

    afterAll(async () => {
        await destroyTestApp(app);
    });

    beforeEach(async () => {
        await dropTestCollection('ctxdbsite');
        await dropTestCollection('ctxdbsecret');
    });

    it('scopes ctx.db().find() to the caller exactly like site.find does', async () => {
        await broker.call('ctxdbsite.create', { host: 'acme-1.com' }, acmeMeta);
        await broker.call('ctxdbsite.create', { host: 'beta-1.com' }, betaMeta);

        const viaCall = await broker.call('ctxdbsite.find', {}, acmeMeta);
        const viaDb = await broker.call('ctxdbsite.viaDbFind', {}, acmeMeta);

        expect(viaDb.map(s => s.host)).toEqual(['acme-1.com']);
        expect(viaDb.map(s => s.host)).toEqual(viaCall.map(s => s.host));
    });

    it('an explicit meta override on ctx.db() reaches a different scope than the caller\'s own ambient ctx.meta', async () => {
        await broker.call('ctxdbsite.create', { host: 'acme-1.com' }, acmeMeta);
        await broker.call('ctxdbsite.create', { host: 'beta-1.com' }, betaMeta);

        // Called as acme, but explicitly overriding ctx.db()'s scope to beta -- proves the override
        // parameter, not just the default-to-ctx.meta path, actually takes effect.
        const crossTenant = await broker.call('ctxdbsite.viaDbFindAs', { asTenant: 'beta' }, acmeMeta);
        expect(crossTenant.map(s => s.host)).toEqual(['beta-1.com']);

        // And omitting the override still confines to the caller's own ambient scope, unaffected.
        const ownScope = await broker.call('ctxdbsite.viaDbFind', {}, acmeMeta);
        expect(ownScope.map(s => s.host)).toEqual(['acme-1.com']);
    });

    it('refuses ctx.db().get() across a scope boundary exactly like site.get does -- 404, not a leak', async () => {
        const betaDoc = await broker.call('ctxdbsite.create', { host: 'secret-beta.com' }, betaMeta);

        let viaCallError: MeshError | undefined;
        try {
            await broker.call('ctxdbsite.get', { id: betaDoc.id }, acmeMeta);
        } catch (err) {
            if (err instanceof MeshError) viaCallError = err;
        }

        let viaDbError: MeshError | undefined;
        try {
            await broker.call('ctxdbsite.viaDbGet', { id: betaDoc.id }, acmeMeta);
        } catch (err) {
            if (err instanceof MeshError) viaDbError = err;
        }

        expect(viaCallError?.status).toBe(404);
        expect(viaCallError?.code).toBe('NOT_FOUND');
        expect(viaDbError?.status).toBe(viaCallError?.status);
        expect(viaDbError?.code).toBe(viaCallError?.code);
    });

    it('refuses ctx.db() with no resolvable scope exactly like ctx.call() does -- 401, not a silent full-collection read', async () => {
        let viaDbError: MeshError | undefined;
        try {
            await broker.call('ctxdbsite.viaDbFind', {}, { meta: {} });
        } catch (err) {
            if (err instanceof MeshError) viaDbError = err;
        }

        expect(viaDbError).toBeDefined();
        expect(viaDbError?.status).toBe(401);
        expect(viaDbError?.code).toBe('UNAUTHORIZED');
    });

    it('strips a hidden field through ctx.db().get() exactly like ctxdbsecret.get does', async () => {
        const created = await broker.call('ctxdbsecret.create', { name: 'registrar', apiKey: 'real-secret' });

        const viaCall = await broker.call('ctxdbsecret.get', { id: created.id });
        const viaDb = await broker.call('ctxdbsecret.viaDbGet', { id: created.id });

        expect(viaCall.apiKey).toBeUndefined();
        expect(viaDb.apiKey).toBeUndefined();
        expect(viaDb.name).toBe('registrar');
    });
});
