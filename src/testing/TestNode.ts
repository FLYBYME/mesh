import { MeshApp } from '../core/MeshApp.js';
import { PlacementRegistry } from '../core/PlacementRegistry.js';
import { RegistryModule } from '../modules/RegistryModule.js';
import { NetworkModule } from '../modules/NetworkModule.js';
import { BrokerModule } from '../modules/BrokerModule.js';
import { DatabaseModule } from '../modules/DatabaseModule.js';
import { WSTransport } from '../transports/node/WSTransport.js';
import { JSONSerializer } from '../serializers/JSONSerializer.js';
import { Logger } from '../utils/Logger.js';
import { LogLevel } from '../interfaces/ILogger.js';

export interface TestNodeOptions {
    readonly nodeID: string;
    /** Its WebSocket port on 127.0.0.1. */
    readonly port: number;
    /** Another test node to join, `ws://127.0.0.1:<port>`; the first node has none. */
    readonly bootstrapNode?: string;
    /**
     * The database every node of the test shares, by name (the test drops it). Omit for a node with
     * no database at all, as the proxy's tests run.
     */
    readonly dbName?: string;
    readonly mongoUri?: string;
    readonly logLevel?: LogLevel;
}

/**
 * One real mesh node for a multi-node test: placement registry, a WebSocket transport, the broker,
 * and the shared test database when named. Started, ready to register on and call through.
 *
 * Every service's twoNode test had its own copy of this (`bootNode`, 10 repos, 10-10).
 */
export async function createTestNode(options: TestNodeOptions): Promise<MeshApp> {
    const app = new MeshApp({ nodeID: options.nodeID, logger: new Logger(options.logLevel ?? LogLevel.ERROR) });

    app.use(new RegistryModule({ implementation: PlacementRegistry }));
    app.use(new NetworkModule({
        transports: [new WSTransport(new JSONSerializer(), options.port, '127.0.0.1')],
        ...(options.bootstrapNode !== undefined ? { bootstrapNodes: [options.bootstrapNode] } : {}),
    }));

    if (options.dbName !== undefined) {
        const uri = options.mongoUri ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017';
        app.use(new DatabaseModule({ uri, dbName: options.dbName }));
    }

    app.use(new BrokerModule());
    await app.start();

    return app;
}
