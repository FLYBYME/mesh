import http from 'node:http';
import { z } from 'zod';
import { MeshApp } from '../../core/MeshApp.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { PlacementRegistry } from '../../core/PlacementRegistry.js';
import { defineContract, defaultPrint } from '../../interfaces/IToolContract.js';
import type { IServiceBroker } from '../../interfaces/IServiceBroker.js';
import type { IMeshMeta } from '../../interfaces/IMeshMeta.js';

/**
 * A part is often loaded *inside* someone's call: placement loads it on demand, from the first
 * caller that needs it, and an operator's `serve.node.label` loads core parts too. Whatever that
 * part starts -- an interval timer, a long-running listener -- must not keep the loading call's
 * context. AsyncLocalStorage hands it to every timer tick and every later http request otherwise,
 * so one user's `meta` becomes the base of every call they make (observability-review.md T1).
 */
const common = {
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    filePath: 'src/__tests__/core/ContextIsolation.spec.ts',
    permissions: [],
    print: defaultPrint,
};
const load = defineContract({ ...common, domain: 'iso', action: 'load', description: 'Loads the others, as a placement would', concurrency: 'on-demand' });
const probe = defineContract({ ...common, domain: 'iso', action: 'probe', description: 'Records the meta it was called with', concurrency: 'on-demand' });
const tick = defineContract({ ...common, domain: 'iso', action: 'tick', description: 'A timer', concurrency: 'interval', intervalMs: 60_000 });
const listen = defineContract({ ...common, domain: 'iso', action: 'listen', description: 'An http listener', concurrency: 'long-running' });

declare global {
    interface IServiceToolRegistry {
        'iso.load': { params: Record<string, never>; returns: Record<string, never> };
        'iso.probe': { params: Record<string, never>; returns: Record<string, never> };
        'iso.tick': { params: Record<string, never>; returns: Record<string, never> };
        'iso.listen': { params: Record<string, never>; returns: Record<string, never> };
    }
}

const alice: IMeshMeta = { user: { id: 'alice', tenant_id: 'org-a' }, tenant_id: 'org-a' };

describe('what a part starts does not keep the context it was loaded in', () => {
    let app: MeshApp;
    let broker: IServiceBroker;
    let server: http.Server | undefined;
    let port = 0;
    const tickSaw: (IMeshMeta | undefined)[] = [];
    const probeSaw: (IMeshMeta | undefined)[] = [];

    beforeAll(async () => {
        app = new MeshApp({ nodeID: 'iso-node', namespace: 'test', logger: new Logger(LogLevel.WARN) });
        app.use(new RegistryModule({ preferLocal: true, implementation: PlacementRegistry }));
        app.use(new BrokerModule());
        await app.start();
        broker = app.getProvider<IServiceBroker>('broker');

        broker.registerContract(probe, async (_params, ctx) => {
            probeSaw.push(ctx.meta);
            return {};
        });
        broker.registerContract(load, async () => {
            broker.registerContract(tick, async (_params, ctx) => {
                tickSaw.push(ctx.meta);
                return {};
            });
            broker.registerContract(listen, async () => {
                const listening = http.createServer((_req, res) => {
                    // Like the api gateway's bare calls: no meta of its own.
                    void broker.call('iso.probe', {}).then(() => res.end('ok'));
                });
                await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve));
                const address = listening.address();
                if (address !== null && typeof address === 'object') port = address.port;
                server = listening;
                return {};
            });
            await broker.call('iso.listen', {}, { nodeID: 'iso-node' });
            return {};
        });

        await broker.call('iso.load', {}, { meta: alice });
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => (server === undefined ? resolve() : server.close(() => resolve())));
        await app.stop();
    });

    it('an interval tick has no user and no organization', async () => {
        await new Promise((r) => setTimeout(r, 1500));

        expect(tickSaw.length).toBeGreaterThan(0);
        expect(tickSaw[0]?.user).toBeUndefined();
        expect(tickSaw[0]?.tenant_id).toBeUndefined();
    });

    it('a later http request has no user and no organization', async () => {
        await new Promise<void>((resolve, reject) => {
            http.get({ host: '127.0.0.1', port, path: '/' }, (res) => { res.resume(); res.on('end', resolve); }).on('error', reject);
        });

        expect(probeSaw.length).toBe(1);
        expect(probeSaw[0]?.user).toBeUndefined();
        expect(probeSaw[0]?.tenant_id).toBeUndefined();
    });
});
