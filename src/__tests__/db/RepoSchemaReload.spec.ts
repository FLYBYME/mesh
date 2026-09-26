import { z } from 'zod';
import { Database } from '../../db/Database.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { dropTestCollection, TEST_DB_NAME } from '../helpers/setup.js';
import { withTestDatabase } from '../../testing/TestHelpers.js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true } as { path: string; quiet: boolean });

/**
 * A part reloaded from a new build asks for its collection with a new schema object. The repository
 * must validate with that one: cached by domain alone, it kept the old schema and zod dropped every
 * new field on write -- 200 OK, never stored (surfdns-compute's volume.tenantId, 2026-09-26).
 */
describe('Database.repo after a reload with a new schema', () => {
    const baseUri = withTestDatabase(process.env.MONGODB_URI || 'mongodb://localhost:27017', TEST_DB_NAME);
    const domain = 'repoSchemaReload';
    let db: Database;

    beforeEach(async () => {
        await dropTestCollection(domain);
        db = new Database(new Logger('test', LogLevel.ERROR), baseUri, TEST_DB_NAME);
        await db.connect();
    });

    afterEach(async () => {
        await db.disconnect();
    });

    it('stores a field only the new build\'s schema has', async () => {
        const oldBuild = z.object({ id: z.string(), name: z.string() });
        const newBuild = z.object({ id: z.string(), name: z.string(), tenantId: z.string().optional() });

        const created = await db.repo(oldBuild, domain).create({ name: 'lhspike' });
        await db.repo(newBuild, domain).update(created.id, { tenantId: 't1' });

        expect(await db.repo(newBuild, domain).get(created.id)).toMatchObject({ name: 'lhspike', tenantId: 't1' });
    });

    it('still hands back one repository per schema', () => {
        const schema = z.object({ id: z.string(), name: z.string() });
        expect(db.repo(schema, domain)).toBe(db.repo(schema, domain));
    });
});
