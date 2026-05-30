import { MeshApp } from '../../core/MeshApp.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { DatabaseModule } from '../../modules/DatabaseModule.js';
import { DemoSkill } from '../../examples/demo/demo.service.js';
import { IServiceBroker } from '../../interfaces/IServiceBroker.js';
import { IServiceRegistry } from '../../interfaces/IServiceRegistry.js';
import { Database } from '../../db/Database.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { dropTestCollection, TEST_DB_NAME } from '../helpers/setup.js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true } as any);

describe('MeshApp', () => {
    afterAll(async () => {
        const { dropTestDatabase } = await import('../helpers/setup.js');
        await dropTestDatabase();
    });

    // ─── DI providers ────────────────────────────────────────────────────────

    describe('Provider DI', () => {
        it('should register and retrieve providers', () => {
            const app = new MeshApp({ nodeID: 'di-test', logger: new Logger(LogLevel.WARN) });
            app.registerProvider<string>('custom', 'hello');
            expect(app.hasProvider('custom')).toBe(true);
            expect(app.getProvider<string>('custom')).toBe('hello');
        });

        it('should throw when getting non-existent provider', () => {
            const app = new MeshApp({ nodeID: 'di-test-2', logger: new Logger(LogLevel.WARN) });
            expect(() => app.getProvider('nonexistent')).toThrow('Provider not found');
        });

        it('should report false for non-existent provider', () => {
            const app = new MeshApp({ nodeID: 'di-test-3', logger: new Logger(LogLevel.WARN) });
            expect(app.hasProvider('nonexistent')).toBe(false);
        });
    });

    // ─── full boot lifecycle ─────────────────────────────────────────────────

    describe('Full lifecycle', () => {
        let app: MeshApp;

        afterEach(async () => {
            if (app) await app.stop();
        });

        it('should boot with all modules and provide broker, registry, database', async () => {
            const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
            const baseUri = mongoUri.replace(/\/[^/?]+(\?|$)/, `/${TEST_DB_NAME}$1`);

            app = new MeshApp({ nodeID: 'lifecycle-test', namespace: 'test', logger: new Logger(LogLevel.WARN) });
            app.use(new RegistryModule({ preferLocal: true }));
            app.use(new BrokerModule());
            app.use(new DatabaseModule({ uri: baseUri, dbName: TEST_DB_NAME }));

            await app.start();

            expect(app.hasProvider('broker')).toBe(true);
            expect(app.hasProvider('registry')).toBe(true);
            expect(app.hasProvider('database')).toBe(true);

            const broker = app.getProvider<IServiceBroker>('broker');
            expect(broker).toBeDefined();

            const registry = app.getProvider<IServiceRegistry>('registry');
            expect(registry).toBeDefined();
        });

        it('should call tools through app.call()', async () => {
            const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
            const baseUri = mongoUri.replace(/\/[^/?]+(\?|$)/, `/${TEST_DB_NAME}$1`);

            app = new MeshApp({ nodeID: 'call-test', namespace: 'test', logger: new Logger(LogLevel.WARN) });
            app.use(new RegistryModule({ preferLocal: true }));
            app.use(new BrokerModule());
            app.use(new DatabaseModule({ uri: baseUri, dbName: TEST_DB_NAME }));

            await app.start();
            await app.registerModule(new DemoSkill());

            const result = await app.call('demo.hello', { name: 'AppTest' }) as Record<string, unknown>;
            expect(result.message).toBe('Hello, AppTest! Event dispatched!');
        });
    });

    // ─── middleware queueing ─────────────────────────────────────────────────

    describe('Middleware queueing', () => {
        it('should queue middleware added before broker is available', async () => {
            const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
            const baseUri = mongoUri.replace(/\/[^/?]+(\?|$)/, `/${TEST_DB_NAME}$1`);

            const app = new MeshApp({ nodeID: 'mw-queue-test', logger: new Logger(LogLevel.WARN) });

            const order: string[] = [];
            app.use(async (_ctx: unknown, next: () => Promise<unknown>) => {
                order.push('queued-mw');
                return next();
            });

            app.use(new RegistryModule({ preferLocal: true }));
            app.use(new BrokerModule());
            app.use(new DatabaseModule({ uri: baseUri, dbName: TEST_DB_NAME }));

            await app.start();
            await app.registerModule(new DemoSkill());

            await app.call('demo.hello', { name: 'Queue' });
            expect(order).toContain('queued-mw');

            await app.stop();
        });
    });
});
