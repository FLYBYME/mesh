import { MeshApp } from '../../core/MeshApp.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { DatabaseModule } from '../../modules/DatabaseModule.js';
import { DemoSkill } from '../../examples/demo/demo.service.js';
import { Database } from '../../db/Database.js';
import { Logger } from '../../utils/Logger.js';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true } as any);

// Create a unique database name for each test process (worker) to allow parallel execution
const TEST_DB_SUFFIX = Math.random().toString(36).substring(2, 8);
const TEST_DB_NAME = `mesh_test_${TEST_DB_SUFFIX}`;

/**
 * Creates a fully wired MeshApp with real Registry, Broker, Database, and DemoSkill.
 * Uses the real MongoDB connection from .env against the `mesh_test` database.
 */
export async function createTestApp(nodeID = 'test-node-1'): Promise<MeshApp> {
    const logger = new Logger('warn' as never);
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';

    // Strip existing DB name from URI and use test DB
    const baseUri = mongoUri.replace(/\/[^/?]+(\?|$)/, `/${TEST_DB_NAME}$1`);

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
 * Cleans up a test app: stops the app and drops the test database.
 */
export async function destroyTestApp(app: MeshApp): Promise<void> {
    await app.stop();
}

/**
 * Drops the entire mesh_test database — call in afterAll.
 */
export async function dropTestDatabase(): Promise<void> {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    const client = new MongoClient(mongoUri);
    try {
        await client.connect();
        await client.db(TEST_DB_NAME).dropDatabase();
    } catch (err) {
        // Silently ignore dropDatabase permission errors (common on Atlas)
        // The isolation is still preserved by unique TEST_DB_NAME
    } finally {
        await client.close();
    }
}

/**
 * Clears all documents from a specific collection within the test database.
 */
export async function dropTestCollection(collectionName: string): Promise<void> {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    const baseUri = mongoUri.replace(/\/[^/?]+(\?|$)/, `/${TEST_DB_NAME}$1`);
    const client = new MongoClient(baseUri);
    try {
        await client.connect();
        await client.db(TEST_DB_NAME).collection(collectionName).deleteMany({});
    } catch (err) {
        // Ignore errors if collection doesn't exist yet
    } finally {
        await client.close();
    }
}

export { TEST_DB_NAME };
