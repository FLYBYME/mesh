import { MongoClient } from 'mongodb';
import { createTestApp, destroyTestApp } from '../../testing/TestHelpers.js';

/**
 * createTestApp makes a fresh `mesh_test_xxxxxx` database each time; destroyTestApp must drop it.
 * It only stopped the app, and 1,021 of them piled up locally until mongod ran out of file
 * descriptors (2026-10-04).
 */
const MONGO = process.env.MONGODB_URI || 'mongodb://localhost:27017';

async function databases(): Promise<string[]> {
    const client = new MongoClient(MONGO);
    try {
        await client.connect();

        return (await client.db().admin().listDatabases({ nameOnly: true })).databases.map((d) => d.name);
    } finally {
        await client.close();
    }
}

describe('the test app helpers', () => {
    it('destroyTestApp drops the database createTestApp made', async () => {
        const { app, dbName } = await createTestApp({ nodeID: 'helpers-drop', mongoUri: MONGO });

        // Something written, so the database really exists on the server.
        const client = new MongoClient(MONGO);
        await client.connect();
        await client.db(dbName).collection('probe').insertOne({ at: new Date() });
        await client.close();
        expect(await databases()).toContain(dbName);

        await destroyTestApp(app);

        expect(await databases()).not.toContain(dbName);
    }, 30000);
});
