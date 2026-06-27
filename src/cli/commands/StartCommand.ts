import { Command } from 'commander';
import { BaseCommand } from '../core/BaseCommand.js';
import { C } from '../core/Utils.js';
import { MeshApp } from '../../core/MeshApp.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { NetworkModule } from '../../modules/NetworkModule.js';
import { DatabaseModule } from '../../modules/DatabaseModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { WSTransport } from '../../transports/node/WSTransport.js';
import { JSONSerializer } from '../../serializers/JSONSerializer.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { Logger } from '../../utils/Logger.js';
import fs from 'fs';
import path from 'path';
import { AuthInterceptorHMAC } from '../../browser.js';

interface StartOptions {
    port?: number | string;
    nodeId?: string;
    bootstrap?: string;
    services?: string[];
    db?: string;
    logLevel?: string;
}

/**
 * StartCommand: Launches a full Mesh Node from the CLI.
 */
export class StartCommand extends BaseCommand {
    public readonly name = 'start';
    public readonly description = 'Start a Mesh Node.';
    public readonly category = 'Mesh Engine';

    public register(program: Command): void {
        program
            .command(this.name)
            .description(this.description)
            .option('-p, --port <number>', 'Port for the WebSocket server')
            .option('-i, --node-id <id>', 'Unique Node ID')
            .option('-b, --bootstrap <nodes>', 'Comma-separated bootstrap URLs')
            .option('-s, --services <dirs>', 'Directory list to scan for services (can be comma-separated or specified multiple times)', (val, memo: string[]) => {
                return memo.concat(val.split(',').map(s => s.trim()));
            }, [])
            .option('-d, --db <uri>', 'MongoDB connection URI')
            .option('-l, --log-level <level>', 'Logging level (debug, info, warn, error)')
            .action(async (options: StartOptions, cmd: Command) => {
                await this.execute({ ...cmd.optsWithGlobals(), ...options });
            });
    }

    protected async execute(options: StartOptions): Promise<void> {
        const nodeId = options.nodeId || `node-${Math.random().toString(36).substring(2, 11)}`;
        let port = 5005;
        if (options.port !== undefined) {
            port = typeof options.port === 'string' ? parseInt(options.port, 10) : options.port;
        }
        if (isNaN(port)) port = 5005;
        const bootstrapStr = options.bootstrap || '';
        const bootstrapNodes = bootstrapStr ? bootstrapStr.split(',').map(s => s.trim()) : [];
        const logLevelStr = (options.logLevel || 'info').toLowerCase();

        let logLevel = LogLevel.INFO;
        if (logLevelStr === 'debug') {
            logLevel = LogLevel.DEBUG;
        } else if (logLevelStr === 'warn') {
            logLevel = LogLevel.WARN;
        } else if (logLevelStr === 'error') {
            logLevel = LogLevel.ERROR;
        }

        this.logger.info(`${C.blue}${C.bold}Booting Mesh Node "${nodeId}" on port ${port}...${C.reset}`);

        // Setup Logger
        const logger = new Logger(logLevel);

        try {
            // Setup Serializer
            const serializer = new JSONSerializer();

            // Setup WS Transport
            const wsTransport = new WSTransport(serializer, port);

            // Initialize MeshApp
            const app = new MeshApp({
                nodeID: nodeId,
                logger
            });

            // Use core modules
            app.use(new RegistryModule());

            const networkModule = new NetworkModule({
                port,
                transports: [wsTransport],
                bootstrapNodes
            });

            const network = networkModule.getNetwork();
            network.use(AuthInterceptorHMAC({
                secret: 'secret',
                maxAgeMs: 60 * 60 * 1000,
                allowUnsigned: true
            }));

            app.use(networkModule);
            const dbConfig: { uri?: string } = {};
            if (options.db) dbConfig.uri = options.db;
            app.use(new DatabaseModule(dbConfig));
            app.use(new BrokerModule());

            // If services directories are provided, scan and load them dynamically
            let servicesDirs: string[] = options.services || [];
            if (servicesDirs.length === 0) {
                if (fs.existsSync(path.resolve('src/addons'))) {
                    servicesDirs = ['src/addons'];
                } else if (fs.existsSync(path.resolve('src/services'))) {
                    servicesDirs = ['src/services'];
                }
            }

            for (const dir of servicesDirs) {
                await this.loadServicesFromDirectory(app, dir);
            }

            // Start the application
            await app.start();

            this.logger.info(`${C.green}${C.bold}✔ Mesh Node "${nodeId}" is successfully running on port ${port}${C.reset}`);
            if (bootstrapNodes.length > 0) {
                this.logger.info(`${C.dim}Connected to bootstrap peers: ${bootstrapNodes.join(', ')}${C.reset}`);
            }
            this.logger.info(`${C.dim}Press Ctrl+C to gracefully stop the node${C.reset}\n`);

            // Graceful Shutdown
            const shutdown = async () => {
                this.logger.info(`\n${C.yellow}Gracefully stopping Mesh Node "${nodeId}"...${C.reset}`);
                try {
                    await app.stop();
                    this.logger.info(`${C.green}✔ Stopped cleanly.${C.reset}`);
                    process.exit(0);
                } catch (err: unknown) {
                    this.logger.error(`${C.red}Error during shutdown:${C.reset}`, err instanceof Error ? err.message : String(err));
                    process.exit(1);
                }
            };

            process.on('SIGINT', () => { void shutdown(); });
            process.on('SIGTERM', () => { void shutdown(); });

        } catch (err: unknown) {
            const error = err as Error;
            this.logger.error(`\n${C.red}${C.bold}✖ Failed to start Mesh Node:${C.reset} ${error.message}`);
            process.exit(1);
        }
    }

    private async loadServicesFromDirectory(app: MeshApp, dir: string): Promise<void> {
        const resolvedPath = path.resolve(dir);
        if (!fs.existsSync(resolvedPath)) {
            app.logger.warn(`[StartCommand] Services directory not found: ${resolvedPath}`);
            return;
        }

        const files = this.walkDir(resolvedPath);
        for (const file of files) {
            if (file.endsWith('.service.ts') || file.endsWith('.service.js')) {
                try {
                    const module = await import(path.resolve(file));
                    const ServiceClass = Object.values(module).find(v => typeof v === 'function') as any;
                    if (ServiceClass) {
                        await app.registerModule(new ServiceClass());
                    }
                } catch (err) {
                    app.logger.error(`[StartCommand] Failed to load service ${file}:`, err);
                }
            }
        }
    }

    private walkDir(dir: string): string[] {
        let results: string[] = [];
        const list = fs.readdirSync(dir);
        list.forEach((file) => {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            if (stat && stat.isDirectory()) {
                results = results.concat(this.walkDir(filePath));
            } else {
                results.push(filePath);
            }
        });
        return results;
    }
}
