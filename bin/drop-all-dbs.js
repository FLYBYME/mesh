import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import path from 'path';

/**
 * drop-all-dbs.js
 * 
 * WARNING: This script will drop all non-system databases on your MongoDB server.
 * System databases (admin, config, local) are excluded.
 */

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const client = new MongoClient(uri);

async function run() {
    console.warn('!!! WARNING: This script will drop all user databases on your server !!!');
    console.log(`Connecting to: ${uri}`);

    try {
        await client.connect();
        const admin = client.db().admin();
        const { databases } = await admin.listDatabases();
        
        const systemDbs = ['admin', 'config', 'local'];
        const targets = databases
            .map(db => db.name)
            .filter(name => !systemDbs.includes(name));

        if (targets.length === 0) {
            console.log('No user databases found to drop.');
            return;
        }

        console.log(`Found databases to drop: ${targets.join(', ')}`);
        
        for (const dbName of targets) {
            console.log(`Dropping database: ${dbName}...`);
            await client.db(dbName).dropDatabase();
        }
        
        console.log('Successfully dropped all user databases.');
    } catch (err) {
        console.error('Error occurred:', err);
    } finally {
        await client.close();
    }
}

run();
