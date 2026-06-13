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

describe('Max RPC Timeout Enforcement (1 Hour)', () => {
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

    it('should still allow slow calls that are under the 1-hour limit when using timeout: 0', async () => {
        const broker = app.getProvider<IServiceBroker>('broker');
        
        // 100ms is well under 1 hour.
        const result = await broker.call('timeout.infinite', { delay: 100 }, { timeout: 0 });
        expect(result).toEqual({ success: true });
    });

    it('should enforce a 1-hour timeout even when timeout is set to 0', async () => {
        const broker = app.getProvider<IServiceBroker>('broker');
        
        // We can't easily wait 1 hour in a real test without fake timers,
        // but we can check if the promise rejects after we advance time.
        // Note: Mesh uses SafeTimer which might interact with jest fake timers in complex ways,
        // but standard setTimeout should be caught.
        
        jest.useFakeTimers();
        
        // Call a tool that never resolves (infinite delay)
        const callPromise = broker.call('timeout.infinite', { delay: 4000000 }, { timeout: 0 });
        
        // Advance time by 1 hour + 1ms
        jest.advanceTimersByTime(3600000 + 1);
        
        await expect(callPromise).rejects.toThrow('RPC Timeout');
        
        jest.useRealTimers();
    });
});
