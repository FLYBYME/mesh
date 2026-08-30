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
import { loadManifest, Supervisor } from '../../supervisor/Supervisor.js';
import { SupervisorService } from '../../supervisor/SupervisorService.js';

interface SuperviseOptions {
    config?: string;
    port?: number | string;
    host?: string;
    nodeId?: string;
    bootstrap?: string;
    db?: string;
    logLevel?: string;
}

/**
 * SuperviseCommand: runs a whole fleet of services in one process, each
 * dynamically mounted/unmounted at runtime, per a JSON manifest -- as opposed
 * to `mesh start`'s fixed, decided-at-boot service set.
 */
export class SuperviseCommand extends BaseCommand {
    public readonly name = 'supervise';
    public readonly description = 'Run a fleet of services from a manifest, each individually startable/stoppable at runtime.';
    public readonly category = 'Mesh Engine';

    public register(program: Command): void {
        program
            .command(this.name)
            .description(this.description)
            .requiredOption('-c, --config <path>', 'Path to the Supervisor manifest JSON file')
            .option('-p, --port <number>', 'Port for the WebSocket server')
            .option('-H, --host <address>', 'Bind address for the WebSocket server (default: 0.0.0.0 -- all interfaces). Set to a private/overlay IP to keep mesh RPC off any public interface.')
            .option('-i, --node-id <id>', 'Unique Node ID')
            .option('-b, --bootstrap <nodes>', 'Comma-separated bootstrap URLs')
            .option('-d, --db <uri>', 'MongoDB connection URI')
            .option('-l, --log-level <level>', 'Logging level (debug, info, warn, error)')
            .action(async (options: SuperviseOptions, cmd: Command) => {
                await this.execute({ ...cmd.optsWithGlobals(), ...options });
            });
    }

    protected async execute(options: SuperviseOptions): Promise<void> {
        const nodeId = options.nodeId || `supervisor-${Math.random().toString(36).substring(2, 11)}`;
        let port = 5005;
        if (options.port !== undefined) {
            port = typeof options.port === 'string' ? parseInt(options.port, 10) : options.port;
        }
        if (isNaN(port)) port = 5005;
        const bootstrapStr = options.bootstrap || '';
        const bootstrapNodes = bootstrapStr ? bootstrapStr.split(',').map((s) => s.trim()) : [];
        const logLevelStr = (options.logLevel || 'info').toLowerCase();

        let logLevel = LogLevel.INFO;
        if (logLevelStr === 'debug') logLevel = LogLevel.DEBUG;
        else if (logLevelStr === 'warn') logLevel = LogLevel.WARN;
        else if (logLevelStr === 'error') logLevel = LogLevel.ERROR;

        const host = options.host || '0.0.0.0';
        const logger = new Logger(logLevel);

        if (!options.config) {
            this.logger.error(`${C.red}${C.bold}✖ --config <path> is required${C.reset}`);
            process.exit(1);
        }

        let manifest, baseDir: string;
        try {
            ({ manifest, baseDir } = loadManifest(options.config));
        } catch (err) {
            this.logger.error(`${C.red}${C.bold}✖ Failed to load manifest:${C.reset} ${err instanceof Error ? err.message : String(err)}`);
            process.exit(1);
            return;
        }

        // Requested/default port may already be in use -- expected when running many
        // Supervisor instances on one node (the real, intended way to run this platform's
        // services going forward, one manifest per deployable unit). Bump sequentially and
        // retry rather than failing outright; only for a genuine bind conflict, not any
        // other startup failure.
        // A bumped port with no bootstrap silently starts a SECOND, isolated mesh on
        // the same machine. Everything reports healthy, and nothing can see anything
        // else -- which is exactly what an occupied port means it should NOT do: the
        // process already holding the port we asked for is almost always a mesh node,
        // so the right response to "someone is already there" is to join them, not to
        // set up next door and pretend to be alone.
        //
        // Only ever applied when no --bootstrap was given; an explicit one is the
        // operator's decision and is never overridden.
        const MAX_PORT_ATTEMPTS = 50;
        let app: MeshApp | undefined;
        let attemptPort = port;
        let lastErr: unknown;
        let occupiedPort: number | undefined;

        // 0.0.0.0 is a bind address, not a dialable one -- the occupant is reachable
        // on loopback from here regardless of what it bound.
        const bootstrapFor = (occupied: number): string[] =>
            bootstrapNodes.length > 0 ? bootstrapNodes : [`ws://127.0.0.1:${occupied}`];

        for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
            this.logger.info(`${C.blue}${C.bold}Booting Supervisor "${nodeId}" on ${host}:${attemptPort}, manifest: ${options.config} (${manifest.services.length} service(s))...${C.reset}`);
            try {
                const serializer = new JSONSerializer();
                const wsTransport = new WSTransport(serializer, attemptPort, host);

                const effectiveBootstrap = occupiedPort === undefined
                    ? bootstrapNodes
                    : bootstrapFor(occupiedPort);

                const candidate = new MeshApp({ nodeID: nodeId, logger });
                candidate.use(new RegistryModule());
                candidate.use(new NetworkModule({ port: attemptPort, transports: [wsTransport], bootstrapNodes: effectiveBootstrap }));
                const dbConfig: { uri?: string } = {};
                if (options.db) dbConfig.uri = options.db;
                candidate.use(new DatabaseModule(dbConfig));
                candidate.use(new BrokerModule());

                await candidate.start();
                app = candidate;
                port = attemptPort;
                break;
            } catch (err: unknown) {
                const code = (err as { code?: string } | undefined)?.code;
                if (code !== 'EADDRINUSE') {
                    throw err;
                }
                lastErr = err;
                // Remember the FIRST occupied port, not the latest: that is the node
                // the operator meant to sit alongside, and the mesh gossips the rest.
                if (occupiedPort === undefined) occupiedPort = attemptPort;
                const joining = bootstrapNodes.length === 0
                    ? ` (will bootstrap to ws://127.0.0.1:${occupiedPort} rather than start an isolated mesh)`
                    : '';
                this.logger.warn(`${C.yellow}Port ${attemptPort} already in use, trying ${attemptPort + 1}...${joining}${C.reset}`);
                attemptPort += 1;
            }
        }

        if (!app) {
            this.logger.error(`${C.red}${C.bold}✖ Failed to find a free port after ${MAX_PORT_ATTEMPTS} attempts starting from ${port}:${C.reset} ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
            process.exit(1);
            return;
        }

        try {
            // Mounted first, before any manifest-defined service starts, so the
            // control surface is live even if a dynamic service fails to start.
            const supervisor = new Supervisor(app, manifest, baseDir);
            await app.registerModule(new SupervisorService(supervisor));

            const results = await supervisor.startAll();
            for (const r of results) {
                if (r.status === 'running') {
                    this.logger.info(`${C.green}  ✔ ${r.name} (domain: ${r.domain})${C.reset}`);
                } else {
                    this.logger.error(`${C.red}  ✖ ${r.name}: ${r.error}${C.reset}`);
                }
            }

            this.logger.info(`${C.green}${C.bold}✔ Supervisor "${nodeId}" is running on ${host}:${port}${C.reset}`);
            this.logger.info(`${C.dim}Press Ctrl+C to gracefully stop the node${C.reset}\n`);

            const shutdown = async () => {
                this.logger.info(`\n${C.yellow}Gracefully stopping Supervisor "${nodeId}"...${C.reset}`);
                try {
                    await supervisor.stopAll();
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
            this.logger.error(`\n${C.red}${C.bold}✖ Failed to start Supervisor:${C.reset} ${error.message}`);
            process.exit(1);
        }
    }
}
