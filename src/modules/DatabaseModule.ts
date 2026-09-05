import { IMeshModule, IMeshApp, ILogger } from '../interfaces/index.js';
import { Database } from '../db/Database.js';
import { createDatabaseMiddleware } from '../db/DatabaseMiddleware.js';
import { IServiceBroker } from '../interfaces/IServiceBroker.js';

export interface DatabaseModuleConfig {
    uri?: string;
    dbName?: string;
}

export class DatabaseModule implements IMeshModule {
    public readonly name = 'database';
    private db!: Database;
    public logger!: ILogger;
    
    constructor(private config: DatabaseModuleConfig = {}) {}

    onInit(app: IMeshApp): void {
        this.logger = app.logger;
        this.db = new Database(this.logger, this.config.uri, this.config.dbName);
        app.registerProvider('database', this.db);
        app.registerProvider('db', this.db);
    }

    async onStart(app: IMeshApp): Promise<void> {
        await this.db.connect();
        await this.db.ensureIndexes();
        this.logger.info(`[DatabaseModule] Unique indexes ensured.`);
        
        if (app.hasProvider('broker')) {
            const broker = app.getProvider<IServiceBroker>('broker');
            broker.registerProvider('database', this.db);
            broker.registerProvider('db', this.db);
            const middleware = createDatabaseMiddleware(broker, this.db);
            broker.useLocal(middleware);
            this.logger.info(`[DatabaseModule] Database middleware installed on local broker.`);
        } else {
            this.logger.warn(`[DatabaseModule] Broker not found, CRUD operations will not be automatically intercepted.`);
        }
    }

    async onStop(): Promise<void> {
        if (this.db) {
            await this.db.disconnect();
        }
    }
}
