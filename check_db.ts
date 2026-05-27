import { MongoClient } from 'mongodb';

async function main() {
    const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017');
    await client.connect();
    const db = client.db('castellan');
    const docs = await db.collection('ollama').find({}).toArray();
    console.log("Documents in ollama collection:", JSON.stringify(docs, null, 2));
    await client.close();
}

main().catch(console.error);
