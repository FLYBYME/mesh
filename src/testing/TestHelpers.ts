import { MeshApp } from '../core/MeshApp.js';
import { RegistryModule } from '../modules/RegistryModule.js';
import { BrokerModule } from '../modules/BrokerModule.js';
import { DatabaseModule } from '../modules/DatabaseModule.js';
import { Logger } from '../utils/Logger.js';
import { LogLevel } from '../interfaces/ILogger.js';
import { MongoClient } from 'mongodb';
import { IServiceModule } from '../interfaces/IServiceModule.js';

/**
 * Configuration options for creating a test MeshApp.
 */
export interface TestAppOptions {
    nodeID?: string;
    namespace?: string;
    logLevel?: LogLevel;
    mongoUri?: string;
    modules?: IServiceModule[];
}

/**
 * Generates a unique database name for test isolation.
 */
export function generateTestDbName(): string {
    const suffix = Math.random().toString(36).substring(2, 8);
    return `mesh_test_${suffix}`;
}

/**
 * Creates a fully wired MeshApp with Registry, Broker, and Database.
 * Uses the provided MongoDB connection or defaults to localhost, pointing to a unique test DB.
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<{ app: MeshApp, dbName: string }> {
    const nodeID = options.nodeID || 'test-node-1';
    const namespace = options.namespace || 'test';
    const logger = new Logger(options.logLevel ?? LogLevel.WARN);
    const mongoUri = options.mongoUri || process.env.MONGODB_URI;
    
    if (!mongoUri) {
        throw new Error('[TestHelpers] MONGODB_URI environment variable or options.mongoUri must be configured.');
    }
    
    const dbName = generateTestDbName();
    
    // Strip existing DB name from URI and use the isolated test DB
    const baseUri = mongoUri.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);

    const app = new MeshApp({
        nodeID,
        namespace,
        logger,
    });

    app.use(new RegistryModule({ preferLocal: true }));
    app.use(new BrokerModule());
    app.use(new DatabaseModule({ uri: baseUri, dbName }));

    await app.start();

    if (options.modules) {
        for (const mod of options.modules) {
            await app.registerModule(mod);
        }
    }

    return { app, dbName };
}

/**
 * Cleans up a test app by stopping it.
 */
export async function destroyTestApp(app: MeshApp): Promise<void> {
    if (app) {
        await app.stop();
    }
}

/**
 * Drops an entire test database.
 */
export async function dropTestDatabase(dbName: string, mongoUri?: string): Promise<void> {
    const uri = mongoUri || process.env.MONGODB_URI;
    if (!uri) {
        throw new Error('[TestHelpers] MONGODB_URI environment variable or mongoUri must be configured.');
    }
    const client = new MongoClient(uri);
    try {
        await client.connect();
        await client.db(dbName).dropDatabase();
    } catch (err) {
        // Report if dropping fails (important now that user has permission)
        console.warn(`[TestHelper] Could not drop database ${dbName}: ${err}`);
    } finally {
        await client.close();
    }
}

/**
 * Clears all documents from a specific collection within a test database.
 */
export async function dropTestCollection(dbName: string, collectionName: string, mongoUri?: string): Promise<void> {
    const uri = mongoUri || process.env.MONGODB_URI;
    if (!uri) {
        throw new Error('[TestHelpers] MONGODB_URI environment variable or mongoUri must be configured.');
    }
    const baseUri = uri.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);
    const client = new MongoClient(baseUri);
    try {
        await client.connect();
        await client.db(dbName).collection(collectionName).deleteMany({});
    } catch (err) {
        // Ignore errors if collection doesn't exist yet
    } finally {
        await client.close();
    }
}
