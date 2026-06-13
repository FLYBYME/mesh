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
        'timeout.infinite': {
            params: { delay: number };
            returns: { success: boolean };
        };
    }
}

const infiniteToolContract = defineContract({
    domain: 'timeout',
    action: 'infinite',
    description: 'A tool that takes a while, testing infinite timeout.',
    inputSchema: z.object({ delay: z.number() }),
    outputSchema: z.object({ success: z.boolean() }),
    rest: { method: 'POST', path: '/timeout/infinite' },
    print: defaultPrint,
    timeout: 50 // Short default to ensure we are overriding it
});

class InfiniteService extends ServiceModule {
    public readonly domain = 'timeout';
    constructor() {
        super();
        this.mountTool(infiniteToolContract, async (args) => {
            await new Promise(resolve => setTimeout(resolve, args.delay));
            return { success: true };
        });
    }
}

describe('Infinite RPC Timeouts (timeout: 0)', () => {
    let app: MeshApp;

    beforeAll(async () => {
        const logger = new Logger(LogLevel.ERROR);
        const serializer = new JSONSerializer();
        app = new MeshApp({ nodeID: 'test-node', logger });
        app.use(new RegistryModule());
        app.use(new NetworkModule({ port: 6200, transports: [new WSTransport(serializer, 6200)] }));
        app.use(new BrokerModule());
        await app.start();
        await app.registerModule(new InfiniteService());
    });

    afterAll(async () => {
        await app?.stop();
    });

    it('should NOT timeout when timeout is set to 0, even if the call is slow', async () => {
        const broker = app.getProvider<IServiceBroker>('broker');
        
        // We set a delay of 100ms, which is > contract's 50ms default.
        // With timeout: 0, it should wait indefinitely (or at least 100ms in this test).
        const result = await broker.call('timeout.infinite', { delay: 100 }, { timeout: 0 });
        expect(result).toEqual({ success: true });
    });
});
