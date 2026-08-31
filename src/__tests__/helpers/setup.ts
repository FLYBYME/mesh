import { DemoSkill } from '../../examples/demo/demo.service.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { 
    destroyTestApp,
    dropTestDatabase as genericDropTestDatabase,
    dropTestCollection as genericDropTestCollection,
    generateTestDbName,
    withTestDatabase
} from '../../testing/index.js';
import { MeshApp } from '../../core/MeshApp.js';
import { Logger } from '../../utils/Logger.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { DatabaseModule } from '../../modules/DatabaseModule.js';
import dotenv from 'dotenv';
import path from 'path';

declare global {
    interface EventRegistry {
        'test.event': { data: string };
        'test.foo': { a: number };
        'test.bar': { b: number };
        'unsub.test': { first?: boolean; second?: boolean };
    }
}

dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true } as any);

// The database name used by the current worker process
const TEST_DB_NAME = generateTestDbName();

/**
 * Creates a fully wired MeshApp with real Registry, Broker, Database, and DemoSkill.
 * Uses the real MongoDB connection from .env against an isolated test database.
 */
export async function createTestApp(nodeID = 'test-node-1'): Promise<MeshApp> {
    const logger = new Logger(LogLevel.WARN);
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        throw new Error('[setup.ts] MONGODB_URI environment variable must be configured.');
    }
    const baseUri = withTestDatabase(mongoUri, TEST_DB_NAME);

    const app = new MeshApp({
        nodeID,
        namespace: 'test',
        logger,
    });

    app.use(new RegistryModule({ preferLocal: true }));
    app.use(new BrokerModule());
    app.use(new DatabaseModule({ uri: baseUri, dbName: TEST_DB_NAME }));

    await app.start();

    // Register the demo service module
    const demoSkill = new DemoSkill();
    await app.registerModule(demoSkill);

    return app;
}

/**
 * Cleans up a test app.
 */
export { destroyTestApp };

/**
 * Drops the test database — call in afterAll.
 */
export async function dropTestDatabase(name?: string): Promise<void> {
    await genericDropTestDatabase(name || TEST_DB_NAME);
}

/**
 * Clears all documents from a specific collection within the test database.
 */
export async function dropTestCollection(collectionName: string): Promise<void> {
    await genericDropTestCollection(TEST_DB_NAME, collectionName);
}

export { TEST_DB_NAME };
