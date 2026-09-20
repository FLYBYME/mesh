import { z } from 'zod';
import { MeshApp } from '../../core/MeshApp.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { PlacementRegistry } from '../../core/PlacementRegistry.js';
import { ServiceBroker } from '../../core/ServiceBroker.js';
import { defineContract, defaultPrint, globalContractRegistry } from '../../interfaces/IToolContract.js';
import type { IServiceBroker } from '../../interfaces/IServiceBroker.js';
import type { IServiceRegistry } from '../../interfaces/IServiceRegistry.js';

/**
 * The point of the whole exercise: a contract that stands entirely alone -- no `ServiceModule`
 * subclass, no class at all, no grouping -- can be mounted, routed to, called, and unmounted on its
 * own. `ServiceBroker.registerContract` is the broker-side half; `PlacementRegistry.registerContract`
 * is the discovery half.
 */

const standaloneInput = z.object({ name: z.string() });
const standaloneOutput = z.object({ greeting: z.string() });

const standaloneContract = defineContract({
    domain: 'standalone',
    action: 'greet',
    description: 'A contract with no module behind it at all.',
    inputSchema: standaloneInput,
    outputSchema: standaloneOutput,
    rest: { method: 'POST', path: '/standalone/greet' },
    filePath: 'src/__tests__/core/StandaloneContract.spec.ts',
    concurrency: 'on-demand',
    permissions: [],
    print: defaultPrint,
});

const siblingContract = defineContract({
    domain: 'standalone',
    action: 'shout',
    description: 'A second standalone contract sharing the first one\'s domain.',
    inputSchema: standaloneInput,
    outputSchema: standaloneOutput,
    rest: { method: 'POST', path: '/standalone/shout' },
    filePath: 'src/__tests__/core/StandaloneContract.spec.ts',
    concurrency: 'on-demand',
    permissions: [],
    print: defaultPrint,
});

declare global {
    interface IServiceToolRegistry {
        'standalone.greet': { params: { name: string }; returns: { greeting: string } };
        'standalone.shout': { params: { name: string }; returns: { greeting: string } };
    }
}

describe('standalone contracts (no ServiceModule)', () => {
    let app: MeshApp;
    let broker: ServiceBroker;

    beforeEach(async () => {
        app = new MeshApp({ nodeID: 'standalone-node', namespace: 'test', logger: new Logger(LogLevel.WARN) });
        app.use(new RegistryModule({ preferLocal: true, implementation: PlacementRegistry }));
        app.use(new BrokerModule());
        await app.start();
        broker = app.getProvider<IServiceBroker>('broker') as ServiceBroker;
    });

    afterEach(async () => {
        await app.stop();
    });

    it('mounts and calls a contract with no module behind it', async () => {
        broker.registerContract(standaloneContract, async (params) => ({
            greeting: `Hello, ${params.name}`,
        }));

        const result = await broker.call('standalone.greet', { name: 'world' });
        expect(result.greeting).toBe('Hello, world');
    });

    it('gives that handler a real IServiceContext -- the same one a module-mounted tool gets', async () => {
        let sawNodeID: string | undefined;
        let sawCallable = false;

        broker.registerContract(standaloneContract, async (params, ctx) => {
            sawNodeID = ctx.nodeID;
            sawCallable = typeof ctx.call === 'function' && typeof ctx.db === 'function' && typeof ctx.emit === 'function';
            return { greeting: `Hi ${params.name}` };
        });

        await broker.call('standalone.greet', { name: 'ctx' });
        expect(sawNodeID).toBe('standalone-node');
        expect(sawCallable).toBe(true);
    });

    it('advertises itself through the registry, so it is genuinely discoverable and not just locally callable', async () => {
        broker.registerContract(standaloneContract, async () => ({ greeting: 'x' }));

        const registry = app.getProvider<IServiceRegistry>('registry');
        expect(registry.findNodesForTool('standalone.greet').some((n) => n.nodeID === 'standalone-node')).toBe(true);
        expect(registry.selectNode('standalone.greet')?.nodeID).toBe('standalone-node');
    });

    it('refuses to mount the same contract twice rather than silently replacing it', () => {
        broker.registerContract(standaloneContract, async () => ({ greeting: 'first' }));
        expect(() => broker.registerContract(standaloneContract, async () => ({ greeting: 'second' })))
            .toThrow(/already mounted/);
    });

    it('unmounts exactly one contract, leaving a sibling on the same domain callable', async () => {
        broker.registerContract(standaloneContract, async () => ({ greeting: 'greet' }));
        broker.registerContract(siblingContract, async () => ({ greeting: 'shout' }));

        expect(broker.listContracts()).toHaveLength(2);

        broker.unregisterContract('standalone.greet');

        expect(broker.listContracts()).toHaveLength(1);
        await expect(broker.call('standalone.greet', { name: 'gone' })).rejects.toThrow(/not found/i);

        // The sibling is untouched -- both locally callable and still advertised.
        const stillThere = await broker.call('standalone.shout', { name: 'here' });
        expect(stillThere.greeting).toBe('shout');

        const registry = app.getProvider<IServiceRegistry>('registry');
        expect(registry.findNodesForTool('standalone.shout').length).toBeGreaterThan(0);
        expect(registry.findNodesForTool('standalone.greet')).toHaveLength(0);
    });

    it('refuses to unmount something that was never mounted standalone', () => {
        expect(() => broker.unregisterContract('standalone.greet')).toThrow(/not registered as a standalone contract/);
    });

    it('leaves the global contract registry clean after unmounting -- a later remount is not shadowed by a stale entry', () => {
        broker.registerContract(standaloneContract, async () => ({ greeting: 'x' }));
        expect(globalContractRegistry.has('standalone.greet')).toBe(true);

        broker.unregisterContract('standalone.greet');
        expect(globalContractRegistry.has('standalone.greet')).toBe(false);
    });
});
