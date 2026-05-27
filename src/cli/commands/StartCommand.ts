import { Command as CommanderCommand } from 'commander';
import { BaseCommand } from '../core/BaseCommand.js';
import { C } from '../core/Utils.js';
import { MeshApp } from '../../core/MeshApp.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { NetworkModule } from '../../modules/NetworkModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { DatabaseModule } from '../../modules/DatabaseModule.js';
import { WSTransport } from '../../transports/node/WSTransport.js';
import { JSONSerializer } from '../../serializers/JSONSerializer.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import type { IServiceModule } from '../../interfaces/IServiceModule.js';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

interface StartOptions {
    nodeId?: string;
    port?: number;
    bootstrap?: string;
    logLevel: string;
    services?: string;
    db?: string;
}

export class StartCommand extends BaseCommand {
    public readonly name = 'start';
    public readonly description = 'Start a single Mesh Node network engine and services';
    public readonly category = 'System Tools';

    public register(program: CommanderCommand): void {
        program
            .command(this.name)
            .description(this.description)
            .option('-n, --node-id <id>', 'Node identifier (e.g., node-1)')
            .option('-p, --port <number>', 'Port for the WebSocket server to listen on (default: 5005)', (val) => parseInt(val, 10))
            .option('-b, --bootstrap <nodes>', 'Comma-separated list of bootstrap node URLs')
            .option('-l, --log-level <level>', 'Log level (debug, info, warn, error)', 'info')
            .option('-s, --services <dir>', 'Directory containing custom services/skills to register dynamically')
            .option('--db <uri>', 'MongoDB URI')
            .action((options: StartOptions) => {
                void this.execute(options);
            });
    }

    protected async execute(options: StartOptions): Promise<void> {
        const nodeId = options.nodeId || `node-${Math.random().toString(36).substring(2, 11)}`;
        const port = options.port !== undefined ? options.port : 5005;
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

        console.log(`${C.blue}${C.bold}Booting Mesh Node "${nodeId}"...${C.reset}`);

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
            app.use(new NetworkModule({
                port,
                transports: [wsTransport] as any,
                bootstrapNodes
            }));
            const dbConfig: { uri?: string } = {};
            if (options.db) dbConfig.uri = options.db;
            app.use(new DatabaseModule(dbConfig));
            app.use(new BrokerModule());

            // If services directory is provided, scan and load them dynamically
            let servicesDir = options.services;
            if (!servicesDir) {
                if (fs.existsSync(path.resolve('src/addons'))) {
                    servicesDir = 'src/addons';
                } else if (fs.existsSync(path.resolve('src/services'))) {
                    servicesDir = 'src/services';
                }
            }

            if (servicesDir) {
                await this.loadServicesFromDirectory(app, servicesDir);
            }

            // Start the application
            await app.start();

            console.log(`${C.green}${C.bold}✔ Mesh Node "${nodeId}" is successfully running on port ${port}${C.reset}`);
            if (bootstrapNodes.length > 0) {
                console.log(`${C.dim}Connected to bootstrap peers: ${bootstrapNodes.join(', ')}${C.reset}`);
            }
            console.log(`${C.dim}Press Ctrl+C to gracefully stop the node${C.reset}\n`);

            // Graceful Shutdown
            const shutdown = async () => {
                console.log(`\n${C.yellow}Gracefully stopping Mesh Node "${nodeId}"...${C.reset}`);
                try {
                    await app.stop();
                    console.log(`${C.green}✔ Stopped cleanly.${C.reset}`);
                    process.exit(0);
                } catch (err: unknown) {
                    console.error(`${C.red}Error during shutdown:${C.reset}`, err instanceof Error ? err.message : String(err));
                    process.exit(1);
                }
            };

            process.on('SIGINT', () => { void shutdown(); });
            process.on('SIGTERM', () => { void shutdown(); });

        } catch (err: unknown) {
            const error = err as Error;
            console.error(`\n${C.red}${C.bold}✖ Failed to start Mesh Node:${C.reset} ${error.message}`);
            process.exit(1);
        }
    }

    private async loadServicesFromDirectory(app: MeshApp, dir: string): Promise<void> {
        const resolvedPath = path.resolve(dir);
        if (!fs.existsSync(resolvedPath)) {
            app.logger.warn(`[StartCommand] Services directory not found: ${resolvedPath}`);
            return;
        }

        const files = this.walkDir(resolvedPath).filter(f => f.endsWith('.service.ts') || f.endsWith('.service.js'));

        for (const file of files) {
            try {
                // Convert to file:// URL for dynamic ESM import
                const fileUrl = pathToFileURL(path.resolve(file)).href;
                const moduleContent = await import(fileUrl) as Record<string, unknown>;

                // Find class implementing IServiceModule
                const ServiceClasses = Object.values(moduleContent).filter((v): v is new () => IServiceModule => 
                    typeof v === 'function' && v.prototype && typeof v.prototype.execute === 'function'
                );

                if (ServiceClasses.length === 0) {
                    app.logger.warn(`[StartCommand] No class implementing IServiceModule found in ${file}`);
                    continue;
                }

                for (const ServiceClass of ServiceClasses) {
                    const serviceInstance = new ServiceClass();
                    await app.registerModule(serviceInstance);
                    app.logger.info(`[StartCommand] Registered service: ${serviceInstance.domain} from ${path.basename(file)}`);
                }
            } catch (err) {
                app.logger.error(`[StartCommand] Failed to load service from ${file}:`, { error: err instanceof Error ? err.message : String(err) });
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
