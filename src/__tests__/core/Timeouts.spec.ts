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

// --- Interface Augmentation for Strict Typing in Tests ---
declare global {
    interface IServiceToolRegistry {
        'timeout.slow': {
            params: { delay: number };
            returns: { success: boolean };
        };
    }
}

// --- Custom Slow Service for Testing Timeouts ---
const slowToolContract = defineContract({
    domain: 'timeout',
    action: 'slow',
    description: 'A tool that takes too long to execute.',
    inputSchema: z.object({ delay: z.number() }),
    outputSchema: z.object({ success: z.boolean() }),
    rest: { method: 'POST', path: '/timeout/slow' },
    print: defaultPrint,
    timeout: 50 // The contract has a short default timeout
});

class SlowService extends ServiceModule {
    public readonly domain = 'timeout';

    constructor() {
        super();
        this.mountTool(slowToolContract, async (args) => {
            const delay = args.delay;
            await new Promise(resolve => setTimeout(resolve, delay));
            return { success: true };
        });
    }
}

describe('RPC Timeouts and Multi-Hop Timeouts', () => {
    let app1: MeshApp; // Client
    let app2: MeshApp; // Relay
    let app3: MeshApp; // Provider

    beforeAll(async () => {
        const logger = new Logger(LogLevel.ERROR);
        const serializer = new JSONSerializer();

        // Node 3 (Provider)
        app3 = new MeshApp({ nodeID: 'node-3', logger });
        app3.use(new RegistryModule());
        app3.use(new NetworkModule({ port: 6103, transports: [new WSTransport(serializer, 6103)] }));
        app3.use(new BrokerModule());
        await app3.start();
        await app3.registerModule(new SlowService());

        // Node 2 (Relay - connects to Node 3)
        app2 = new MeshApp({ nodeID: 'node-2', logger });
        app2.use(new RegistryModule());
        app2.use(new NetworkModule({
            port: 6102,
            transports: [new WSTransport(serializer, 6102)],
            bootstrapNodes: ['ws://127.0.0.1:6103']
        }));
        app2.use(new BrokerModule());
        await app2.start();

        // Node 1 (Client - connects to Node 2 only)
        app1 = new MeshApp({ nodeID: 'node-1', logger });
        app1.use(new RegistryModule());
        app1.use(new NetworkModule({
            port: 6101,
            transports: [new WSTransport(serializer, 6101)],
            bootstrapNodes: ['ws://127.0.0.1:6102']
        }));
        app1.use(new BrokerModule());
        await app1.start();

        // Wait for registry sync across all 3 nodes
        await new Promise(r => setTimeout(r, 1000));
    });

    afterAll(async () => {
        await app1?.stop();
        await app2?.stop();
        await app3?.stop();
    });

    it('should timeout when a direct RPC call takes too long', async () => {
        const broker3 = app3.getProvider<IServiceBroker>('broker');
        
        await expect(
            broker3.call('timeout.slow', { delay: 100 }, { timeout: 50 })
        ).rejects.toThrow(/Timeout/);
    });

    it('should timeout when a multi-hop RPC call takes too long', async () => {
        // App1 calls App3 through App2
        const broker1 = app1.getProvider<IServiceBroker>('broker');
        
        await expect(
            // We pass a 100ms timeout. The service takes 200ms.
            broker1.call('timeout.slow', { delay: 200 }, { timeout: 100 })
        ).rejects.toThrow(/Timeout/);
    });

    it('should succeed when a multi-hop RPC call is fast enough', async () => {
        const broker1 = app1.getProvider<IServiceBroker>('broker');
        
        const result = await broker1.call('timeout.slow', { delay: 10 }, { timeout: 500 });
        expect(result).toEqual({ success: true });
    });

    it('should respect the contract-defined timeout on direct RPC call', async () => {
        const broker3 = app3.getProvider<IServiceBroker>('broker');
        
        await expect(
            // Delay 100ms, contract has timeout 50ms. No options.timeout passed.
            broker3.call('timeout.slow', { delay: 100 })
        ).rejects.toThrow(/Timeout/);
    });

    it('should respect the contract-defined timeout on multi-hop RPC call', async () => {
        const broker1 = app1.getProvider<IServiceBroker>('broker');
        
        await expect(
            // Delay 150ms, contract has timeout 50ms. No options.timeout passed.
            broker1.call('timeout.slow', { delay: 150 })
        ).rejects.toThrow(/Timeout/);
    });
});
