import { z } from 'zod';
import { createTestApp, destroyTestApp, dropTestCollection } from '../helpers/setup.js';
import { MeshApp } from '../../core/MeshApp.js';
import { defineCrud } from '../../interfaces/ICrudContract.js';
import { defineContract, defaultPrint } from '../../interfaces/IToolContract.js';
import { IServiceBroker } from '../../interfaces/IServiceBroker.js';
import { asTenant, callerName, callerTenant, everyTenant, inOrganization, resolveCallerTenant, resolveCallerUserId } from '../../core/Tenancy.js';
import { errorMessage, isRecord } from '../../utils/isRecord.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';

/**
 * The helpers every service copied (10-10): who is calling, as which organization, and a collection
 * as one organization or all of them -- read exactly as the database's own scope reads them.
 */

const TenancyWidgetSchema = z.object({ tenantId: z.string(), label: z.string() });

const tenancyWidgetCrud = defineCrud('tenancywidget', TenancyWidgetSchema, {
    scopedBy: 'tenantId',
    dependencies: [], filePath: 'src/__tests__/core/Tenancy.spec.ts', permissions: [],
});

const probeOutput = z.object({ asBeta: z.array(z.string()), every: z.array(z.string()), mine: z.string() });

const probeContract = defineContract({
    domain: 'tenancywidget', action: 'probe',
    description: 'Reads the widgets as beta (asTenant) and as every organization (everyTenant).',
    inputSchema: z.object({}), outputSchema: probeOutput,
    rest: { method: 'GET', path: '/tenancywidget/probe' },
    filePath: 'src/__tests__/core/Tenancy.spec.ts', concurrency: 'on-demand', permissions: [],
    print: defaultPrint,
});

declare global {
    interface IServiceToolRegistry {
        'tenancywidget.create': { params: { label: string; tenantId?: string }; returns: { id: string; label: string; tenantId: string } };
        'tenancywidget.find': { params: { query?: Record<string, unknown> }; returns: Array<{ id: string; label: string; tenantId: string }> };
        'tenancywidget.find_one': { params: { query?: Record<string, unknown> }; returns: { id: string; label: string; tenantId: string } | undefined };
        'tenancywidget.get': { params: { id: string }; returns: { id: string; label: string; tenantId: string } };
        'tenancywidget.resolve': { params: { id: string }; returns: { id: string; label: string; tenantId: string } | undefined };
        'tenancywidget.probe': { params: Record<string, never>; returns: { asBeta: string[]; every: string[]; mine: string } };
    }
    interface IServiceCollectionRegistry {
        'tenancywidget': { id: string; label: string; tenantId: string; createdAt: Date; updatedAt: Date };
    }
}

describe('who is calling', () => {
    it('reads the organization as the database scope does: user first, either spelling', () => {
        expect(callerTenant({ meta: { user: { id: 'u', tenant_id: 'from-user' }, tenant_id: 'from-meta' } })).toBe('from-user');
        expect(callerTenant({ meta: { user: { id: 'u', tenant_id: '', tenantId: 'camel' } } })).toBe('camel');
        expect(callerTenant({ meta: { tenant_id: 'flat' } })).toBe('flat');
        expect(callerTenant({ meta: {} })).toBeUndefined();
        expect(callerTenant({})).toBeUndefined();
    });

    it('refuses a call with no organization, or no account, as 401 -- not a 500', () => {
        expect(() => resolveCallerTenant({ meta: {} })).toThrow(expect.objectContaining({ code: 'UNAUTHORIZED', status: 401 }));
        expect(() => resolveCallerUserId({ meta: { tenant_id: 'org' } })).toThrow(expect.objectContaining({ code: 'UNAUTHORIZED', status: 401 }));
        expect(resolveCallerUserId({ meta: { user: { id: 'u7', tenant_id: 'org' } } })).toBe('u7');
    });

    it('inOrganization: call options for one organization, by the platform or the account named', () => {
        expect(inOrganization('org-1')).toEqual({ meta: { user: { id: 'platform', tenant_id: 'org-1', organizationId: 'org-1' } } });
        expect(inOrganization('org-1', 'u9').meta.user.id).toBe('u9');
        expect(callerTenant(inOrganization('org-1'))).toBe('org-1');
    });

    it('names who did it: the account, else the organization', () => {
        expect(callerName({ meta: { user: { id: 'u7', tenant_id: 'org' } } }, 'org')).toBe('u7');
        expect(callerName({ meta: { tenant_id: 'org' } }, 'org')).toBe('org');
    });

    it('isRecord and errorMessage', () => {
        expect([isRecord({}), isRecord([]), isRecord(null), isRecord('x')]).toEqual([true, false, false, false]);
        expect([errorMessage(new Error('boom')), errorMessage('plain'), errorMessage(42)]).toEqual(['boom', 'plain', '42']);
    });
});

describe('passwords', () => {
    it('verifies what it hashed, and nothing else', async () => {
        const stored = await hashPassword('correct horse');

        expect(stored).toMatch(/^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/);
        expect(await verifyPassword({ password: 'correct horse', stored })).toBe(true);
        expect(await verifyPassword({ password: 'wrong', stored })).toBe(false);
    });

    it('reads the older salt:hash identity stored, so no account has to change', async () => {
        const stored = (await hashPassword('old one')).slice('scrypt:'.length);

        expect(await verifyPassword({ password: 'old one', stored })).toBe(true);
    });

    it('a stored value in neither format is a failed sign-in, not a throw', async () => {
        for (const stored of ['', 'nonsense', 'md5:aa:bb', 'scrypt::', ':']) {
            expect(await verifyPassword({ password: 'x', stored })).toBe(false);
        }
    });
});

describe('a collection as one organization, or all of them', () => {
    let app: MeshApp;
    let broker: IServiceBroker;

    beforeAll(async () => {
        await dropTestCollection('tenancywidget');
        app = await createTestApp('tenancy-node');
        broker = app.getProvider<IServiceBroker>('broker');
        broker.registerCrud(tenancyWidgetCrud);
        broker.registerContract(probeContract, async (_input, ctx) => {
            const asBeta = await asTenant(ctx, 'tenancywidget', 'beta').find({});
            const every = await everyTenant(ctx, 'tenancywidget').find({});

            return { asBeta: asBeta.map((w) => w.label), every: every.map((w) => w.label).sort(), mine: resolveCallerTenant(ctx) };
        });

        await broker.call('tenancywidget.create', { label: 'acme-1' }, { meta: { user: { id: 'u1', tenant_id: 'acme' } } });
        await broker.call('tenancywidget.create', { label: 'beta-1' }, { meta: { user: { id: 'u2', tenant_id: 'beta' } } });
    });

    afterAll(async () => {
        await destroyTestApp(app);
    });

    it('asTenant reads as that organization only; everyTenant reads every one', async () => {
        const probe = await broker.call('tenancywidget.probe', {}, { meta: { user: { id: 'u1', tenant_id: 'acme' } } });

        expect(probe).toEqual({ asBeta: ['beta-1'], every: ['acme-1', 'beta-1'], mine: 'acme' });
    });
});
