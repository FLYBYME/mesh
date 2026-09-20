import { z } from 'zod';
import { MeshApp } from '../../core/MeshApp.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { PlacementRegistry } from '../../core/PlacementRegistry.js';
import { ServiceBroker } from '../../core/ServiceBroker.js';
import { defineContract, defaultPrint } from '../../interfaces/IToolContract.js';
import { defineCrud } from '../../interfaces/ICrudContract.js';
import type { IServiceBroker } from '../../interfaces/IServiceBroker.js';

/**
 * `loadDomain` -- mounting a whole domain from what its contracts declare, instead of from a
 * hand-written `register(broker)` that lists them one at a time.
 *
 * The thing being tested is that nothing is enumerated: the contracts come from the global
 * registry (populated by importing their module), and each one's kind decides how it mounts. A
 * test that passed a complete, hand-built handler map for every contract including the CRUD ones
 * would prove nothing -- so these deliberately supply handlers for *only* the custom contracts and
 * assert the CRUD ones mount anyway.
 */

const widgetSchema = z.object({
    tenantId: z.string(),
    name: z.string(),
});

let hookSaw: unknown;

const widgetCrud = defineCrud('loaded.widget', widgetSchema, {
    pluralPath: 'widgets',
    // Declared on the collection, not passed when it is registered -- everything needed to mount
    // this collection travels with it.
    hooks: {
        create: {
            before: async (input: never) => { hookSaw = input; return input; },
        },
    },
    dependencies: [],
    filePath: 'src/__tests__/core/LoadDomain.spec.ts',
    permissions: [],
});

const customContract = defineContract({
    domain: 'loaded',
    action: 'custom',
    description: 'An ordinary contract whose handler lives elsewhere.',
    inputSchema: z.object({ n: z.number() }),
    outputSchema: z.object({ doubled: z.number() }),
    rest: { method: 'POST', path: '/loaded/custom' },
    filePath: 'src/__tests__/core/handlers/custom.ts',
    concurrency: 'on-demand',
    permissions: [],
    print: defaultPrint,
});

const listenerContract = defineContract({
    domain: 'loaded',
    action: 'listen',
    description: 'A long-running contract the loader is expected to start on its own.',
    inputSchema: z.object({}),
    outputSchema: z.object({ started: z.boolean() }),
    rest: { method: 'POST', path: '/loaded/listen' },
    filePath: 'src/__tests__/core/handlers/listen.ts',
    concurrency: 'long-running',
    permissions: [],
    print: defaultPrint,
});

declare global {
    interface IServiceToolRegistry {
        'loaded.custom': { params: { n: number }; returns: { doubled: number } };
        'loaded.listen': { params: Record<string, never>; returns: { started: boolean } };
    }
}

describe('loadDomain', () => {
    let app: MeshApp;
    let broker: ServiceBroker;
    let listenerStarted = 0;

    beforeEach(async () => {
        listenerStarted = 0;
        app = new MeshApp({ nodeID: 'load-node', namespace: 'test', logger: new Logger(LogLevel.ERROR) });
        app.use(new RegistryModule({ preferLocal: true, implementation: PlacementRegistry }));
        app.use(new BrokerModule());
        await app.start();
        broker = app.getProvider<IServiceBroker>('broker') as ServiceBroker;
    });

    afterEach(async () => {
        await app.stop();
    });

    /** What a generated manifest produces -- thunks, only for the contracts that have handlers. */
    const handlers = {
        'loaded.custom': async () => async (params: { n: number }) => ({ doubled: params.n * 2 }),
        'loaded.listen': async () => async () => {
            listenerStarted += 1;
            return { started: true };
        },
    };

    it('mounts every contract in the domain, including sub-domains, from the registry alone', async () => {
        const result = await broker.loadDomain('loaded', handlers);

        expect(result.domain).toBe('loaded');
        // loaded.custom + loaded.listen + the ten loaded.widget CRUD actions.
        expect(result.contracts).toContain('loaded.custom');
        expect(result.contracts).toContain('loaded.listen');
        expect(result.contracts).toContain('loaded.widget.find');
        expect(result.contracts).toContain('loaded.widget.create');
    });

    it('wires a custom contract to the handler its map resolves', async () => {
        await broker.loadDomain('loaded', handlers);
        const out = await broker.call('loaded.custom', { n: 21 });
        expect(out.doubled).toBe(42);
    });

    it('needs no handler for a CRUD contract -- the middleware owns those', async () => {
        // The map has entries for two contracts; twelve get mounted. If CRUD needed handlers this
        // would throw "no handler for loaded.widget.find".
        await expect(broker.loadDomain('loaded', handlers)).resolves.toBeDefined();
        expect(broker.listContracts().map((c) => `${c.domain}.${c.action}`)).toContain('loaded.widget.get');
    });

    it('starts a long-running contract by itself -- declaring it is what schedules it', async () => {
        expect(listenerStarted).toBe(0);
        await broker.loadDomain('loaded', handlers);
        // Nothing in this test called loaded.listen.
        expect(listenerStarted).toBe(1);
    });

    it('refuses a domain whose contracts were never imported, rather than mounting nothing', async () => {
        await expect(broker.loadDomain('never.imported', {})).rejects.toThrow(/no contracts declare this domain/);
    });

    it('names the missing contract, and the file it declared, when a handler is absent', async () => {
        await expect(broker.loadDomain('loaded', {})).rejects.toThrow(
            /no handler for "loaded\.(custom|listen)".*filePath "src\/__tests__\/core\/handlers\/(custom|listen)\.ts"/s,
        );
    });

    it('wires a CRUD hook the collection itself declares -- nothing passes one in', async () => {
        // The only argument loadDomain gets is the handler map, and it has no hook in it.
        await broker.loadDomain('loaded', handlers);

        const hook = broker.getCrudHooks('loaded.widget', 'create');
        expect(hook?.before).toBeDefined();

        await hook?.before?.({ name: 'w' }, {} as never);
        expect(hookSaw).toEqual({ name: 'w' });
    });

    it('puts a declared hook on the one action it belongs to, not the whole collection', async () => {
        await broker.loadDomain('loaded', handlers);
        expect(broker.getCrudHooks('loaded.widget', 'create')).toBeDefined();
        expect(broker.getCrudHooks('loaded.widget', 'update')).toBeUndefined();
        expect(broker.getCrudHooks('loaded.widget', 'find')).toBeUndefined();
    });

    it('falls back to `resolve` when the map has no entry -- the unbundled case', async () => {
        const asked: string[] = [];
        await broker.loadDomain('loaded', {}, {
            resolve: async (contract) => {
                // What an unbundled loader does: import the file the contract points at, and
                // return the export it names.
                asked.push(contract.filePath);
                if (contract.action === 'listen') return async () => ({ started: true });
                return async (params: { n: number }) => ({ doubled: params.n * 3 });
            },
        });

        expect(asked).toContain('src/__tests__/core/handlers/custom.ts');
        const out = await broker.call('loaded.custom', { n: 5 });
        expect(out.doubled).toBe(15);
    });

    it('prefers the map over `resolve` when both could answer', async () => {
        let resolveCalled = false;
        await broker.loadDomain('loaded', handlers, {
            resolve: async () => { resolveCalled = true; return async () => ({ doubled: 0 }); },
        });

        expect(resolveCalled).toBe(false);
        expect((await broker.call('loaded.custom', { n: 4 })).doubled).toBe(8);
    });
});
