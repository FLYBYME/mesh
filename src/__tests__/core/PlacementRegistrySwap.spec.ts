import { MeshApp } from '../../core/MeshApp.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { DatabaseModule } from '../../modules/DatabaseModule.js';
import { PlacementRegistry } from '../../core/PlacementRegistry.js';
import { DemoSkill } from '../../examples/demo/demo.service.js';
import type { IServiceBroker } from '../../interfaces/IServiceBroker.js';
import { generateTestDbName, withTestDatabase } from '../../testing/index.js';

/**
 * Proves `RegistryModule({ implementation: PlacementRegistry })` is a real, working swap -- not
 * just a class that satisfies `IServiceRegistry` in isolation, but one a whole `MeshApp` can boot
 * and actually dispatch a real call through, the same way it does with the default `Registry`.
 * `demo.hello` genuinely needs a database (it records a time-series metric), so this uses the same
 * real-Mongo test setup `helpers/setup.ts`'s own `createTestApp` does, just with the registry
 * implementation swapped.
 */
describe('RegistryModule swapped to PlacementRegistry', () => {
    let app: MeshApp;
    const dbName = generateTestDbName();

    afterEach(async () => {
        await app.stop();
    });

    it('boots, registers a module, and dispatches a real call end to end', async () => {
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) throw new Error('MONGODB_URI must be configured for this test.');

        app = new MeshApp({ nodeID: 'placement-swap-node', namespace: 'test', logger: new Logger(LogLevel.WARN) });
        app.use(new RegistryModule({ preferLocal: true, implementation: PlacementRegistry }));
        app.use(new BrokerModule());
        app.use(new DatabaseModule({ uri: withTestDatabase(mongoUri, dbName), dbName }));
        await app.start();

        expect(app.getProvider('registry')).toBeInstanceOf(PlacementRegistry);

        await app.registerModule(new DemoSkill());

        const broker = app.getProvider<IServiceBroker>('broker');
        const result = await broker.call('demo.hello', { name: 'PlacementRegistry' });
        expect(result.message).toContain('PlacementRegistry');
    });
});
