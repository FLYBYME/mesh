import { MeshApp } from '../../core/MeshApp.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { NetworkModule } from '../../modules/NetworkModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { WSTransport } from '../../transports/node/WSTransport.js';
import { JSONSerializer } from '../../serializers/JSONSerializer.js';
import { ServiceModule } from '../../core/ServiceModule.js';
import { z } from 'zod';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { defineContract, defaultPrint } from '../../interfaces/IToolContract.js';
import { IServiceBroker } from '../../interfaces/IServiceBroker.js';
import { Registry } from '../../core/Registry.js';

// --- Interface Augmentation for Strict Typing in Tests ---
declare global {
    interface IServiceToolRegistry {
        'nsdemo.echo': {
            params: { msg: string };
            returns: { msg: string };
        };
        'nsdemo.echo2': {
            params: { msg: string };
            returns: { msg: string };
        };
    }
}

const echoContract = defineContract({
    domain: 'nsdemo',
    action: 'echo',
    description: 'Echoes the input message.',
    inputSchema: z.object({ msg: z.string() }),
    outputSchema: z.object({ msg: z.string() }),
    rest: { method: 'POST', path: '/nsdemo/echo' },
    print: defaultPrint,
});

const echo2Contract = defineContract({
    domain: 'nsdemo',
    action: 'echo2',
    description: 'Echoes the input message (second instance).',
    inputSchema: z.object({ msg: z.string() }),
    outputSchema: z.object({ msg: z.string() }),
    rest: { method: 'POST', path: '/nsdemo/echo2' },
    print: defaultPrint,
});

class EchoService extends ServiceModule {
    public readonly domain = 'nsdemo';
    constructor() {
        super();
        this.mountTool(echoContract, async (args) => ({ msg: args.msg }));
    }
}

class Echo2Service extends ServiceModule {
    public readonly domain = 'nsdemo';
    constructor() {
        super();
        this.mountTool(echo2Contract, async (args) => ({ msg: args.msg }));
    }
}

// This proves `namespace` is real, load-bearing routing behavior, not just stored
// metadata (see docs/SUPERVISOR_AND_SERVICE_LIFECYCLE.md, Part 3's prerequisite).
// Real cross-namespace isolation already happens at the packet layer (MeshNetwork
// drops any packet whose namespace differs from the receiver's), so this test proves
// the whole chain end-to-end: a foreign-namespace peer's presence/PEX never reaches
// the Registry, and same-namespace peers still discover and route to each other fine.
describe('Namespace isolation — real, end-to-end', () => {
    let appDefault: MeshApp; // namespace: 'default', hosts nsdemo.echo
    let appTest: MeshApp;    // namespace: 'test', hosts nsdemo.echo2, bootstraps to appDefault
    let appTest2: MeshApp;   // namespace: 'test', no tools, bootstraps to appTest

    beforeAll(async () => {
        const logger = new Logger(LogLevel.ERROR);
        const serializer = new JSONSerializer();

        appDefault = new MeshApp({ nodeID: 'ns-default', logger });
        appDefault.use(new RegistryModule());
        appDefault.use(new NetworkModule({ port: 6301, transports: [new WSTransport(serializer, 6301)] }));
        appDefault.use(new BrokerModule());
        await appDefault.start();
        await appDefault.registerModule(new EchoService());

        appTest = new MeshApp({ nodeID: 'ns-test-1', namespace: 'test', logger });
        appTest.use(new RegistryModule());
        appTest.use(new NetworkModule({
            port: 6302,
            transports: [new WSTransport(serializer, 6302)],
            bootstrapNodes: ['ws://127.0.0.1:6301'],
        }));
        appTest.use(new BrokerModule());
        await appTest.start();
        await appTest.registerModule(new Echo2Service());

        appTest2 = new MeshApp({ nodeID: 'ns-test-2', namespace: 'test', logger });
        appTest2.use(new RegistryModule());
        appTest2.use(new NetworkModule({
            port: 6303,
            transports: [new WSTransport(serializer, 6303)],
            bootstrapNodes: ['ws://127.0.0.1:6302'],
        }));
        appTest2.use(new BrokerModule());
        await appTest2.start();

        // Wait for presence/PEX to propagate as far as it's going to.
        await new Promise((r) => setTimeout(r, 1000));
    });

    afterAll(async () => {
        await appTest2?.stop();
        await appTest?.stop();
        await appDefault?.stop();
    });

    it("never lets a 'test'-namespace node discover a 'default'-namespace node's tool", () => {
        const registryTest = appTest.getProvider<Registry>('registry');
        expect(registryTest.findNodesForTool('nsdemo.echo')).toHaveLength(0);
    });

    it("rejects a 'test'-namespace node's call into a 'default'-namespace-only tool with a real not-found error", async () => {
        const brokerTest = appTest.getProvider<IServiceBroker>('broker');
        await expect(
            brokerTest.call('nsdemo.echo', { msg: 'should never reach appDefault' }, { timeout: 500 })
        ).rejects.toThrow(/not found/i);
    });

    it('still lets same-namespace nodes discover and call each other across hops', async () => {
        const brokerTest2 = appTest2.getProvider<IServiceBroker>('broker');
        const result = await brokerTest2.call('nsdemo.echo2', { msg: 'hello from ns-test-2' }, { timeout: 2000 });
        expect(result.msg).toBe('hello from ns-test-2');
    });

    it("never lets a 'test'-namespace node see a 'default'-namespace tool even transitively through a relay", () => {
        const registryTest2 = appTest2.getProvider<Registry>('registry');
        expect(registryTest2.findNodesForTool('nsdemo.echo')).toHaveLength(0);
    });
});
