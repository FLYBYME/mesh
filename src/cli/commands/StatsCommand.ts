import { Command } from 'commander';
import { BaseCommand } from '../core/BaseCommand.js';
import { C } from '../core/Utils.js';
import { MeshApp } from '../../core/MeshApp.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { NetworkModule } from '../../modules/NetworkModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { WSTransport } from '../../transports/node/WSTransport.js';
import { JSONSerializer } from '../../serializers/JSONSerializer.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { Logger } from '../../utils/Logger.js';

interface StatsOptions {
    bootstrap?: string;
    wait?: number | string;
    verbose?: boolean;
}

/**
 * StatsCommand: Displays real-time statistics and metrics about the connected Mesh network.
 */
export class StatsCommand extends BaseCommand {
    public readonly name = 'stats';
    public readonly description = 'Display Mesh network statistics and node metrics.';
    public readonly category = 'Mesh Engine';

    public register(program: Command): void {
        program
            .command(this.name)
            .description(this.description)
            .option('-b, --bootstrap <nodes>', 'Comma-separated bootstrap URLs (default: ws://127.0.0.1:5005)')
            .option('-w, --wait <ms>', 'Time to wait for node discovery in milliseconds', '2000')
            .option('-v, --verbose', 'Show detailed service and tool information')
            .action(async (options: StatsOptions, cmd: Command) => {
                await this.execute({ ...cmd.optsWithGlobals(), ...options });
            });
    }

    protected async execute(options: StatsOptions): Promise<void> {
        const bootstrapStr = options.bootstrap || 'ws://127.0.0.1:5005';
        const bootstrapNodes = bootstrapStr.split(',').map(s => s.trim());
        const waitMs = typeof options.wait === 'string' ? parseInt(options.wait, 10) : (options.wait || 2000);

        this.logger.info(`${C.blue}${C.bold}Connecting to Mesh network to gather statistics...${C.reset}`);
        
        // Setup Logger (Quiet for the internal app)
        const logger = new Logger(LogLevel.ERROR);

        try {
            const serializer = new JSONSerializer();
            // We use port 0 for a temporary CLI client node
            const wsTransport = new WSTransport(serializer, 0);

            const app = new MeshApp({
                nodeID: `cli-stats-${Math.random().toString(36).substring(2, 7)}`,
                logger
            });

            app.use(new RegistryModule());
            app.use(new NetworkModule({
                port: 0,
                transports: [wsTransport],
                bootstrapNodes
            }));
            app.use(new BrokerModule());

            await app.start();

            // Wait for discovery
            this.logger.info(`${C.dim}Waiting ${waitMs}ms for discovery...${C.reset}`);
            await new Promise(resolve => setTimeout(resolve, waitMs));

            const nodes = app.registry.getNodes();
            
            if (nodes.length === 0) {
                this.logger.warn(`${C.yellow}No nodes discovered. Make sure at least one node is running and reachable.${C.reset}`);
            } else {
                this.printStats(nodes, options.verbose || false);
            }

            await app.stop();
            process.exit(0);

        } catch (err: unknown) {
            const error = err as Error;
            this.logger.error(`\n${C.red}${C.bold}✖ Failed to gather stats:${C.reset} ${error.message}`);
            process.exit(1);
        }
    }

    private printStats(nodes: any[], verbose: boolean): void {
        this.logger.info(`\n${C.green}${C.bold}Mesh Network Overview${C.reset}`);
        this.logger.info(`${C.dim}================================================================================${C.reset}`);

        const summaryData = {
            'Total Nodes': nodes.length,
            'Total Services': nodes.reduce((acc, n) => acc + (n.services?.length || 0), 0),
            'Total Tools': nodes.reduce((acc, n) => {
                return acc + (n.services?.reduce((sAcc: number, s: any) => sAcc + (s.tools ? Object.keys(s.tools).length : 0), 0) || 0);
            }, 0),
            'Total Events': nodes.reduce((acc, n) => {
                return acc + (n.services?.reduce((sAcc: number, s: any) => sAcc + (s.events ? Object.keys(s.events).length : 0), 0) || 0);
            }, 0)
        };

        this.logger.info(`${C.bold}Summary:${C.reset}`);
        Object.entries(summaryData).forEach(([k, v]) => {
            this.logger.info(`  ${C.blue}${k.padEnd(16)}${C.reset}: ${C.bold}${v}${C.reset}`);
        });

        this.logger.info(`\n${C.bold}Node Details:${C.reset}`);
        const nodeTable = nodes.map(node => {
            const resources = node.resources || {};
            const cpu = node.cpu !== undefined ? `${node.cpu.toFixed(1)}%` : (resources.cpu !== undefined ? `${resources.cpu}%` : 'N/A');
            const memUsed = node.memory?.used || resources.memory?.used;
            const memTotal = node.memory?.total || resources.memory?.total;
            const memStr = memUsed && memTotal ? 
                `${Math.round(memUsed / 1024 / 1024)}MB / ${Math.round(memTotal / 1024 / 1024)}MB` : 
                'N/A';
            
            return {
                'Node ID': node.nodeID,
                'Hostname': node.hostname || 'N/A',
                'Status': node.available ? `${C.green}● online${C.reset}` : `${C.red}○ offline${C.reset}`,
                'Health': node.healthScore !== undefined ? `${(node.healthScore * 100).toFixed(0)}%` : 'N/A',
                'CPU': cpu,
                'Memory': memStr,
                'Svc': node.services?.length || 0,
                'Uptime': node.bootedAt ? this.formatUptime(Date.now() - node.bootedAt) : 'N/A'
            };
        });

        console.table(nodeTable);

        if (verbose) {
            this.logger.info(`\n${C.bold}Service & Tool Inventory:${C.reset}`);
            nodes.forEach(node => {
                this.logger.info(`\n${C.blue}${C.bold}Node: ${node.nodeID}${C.reset}`);
                if (!node.services || node.services.length === 0) {
                    this.logger.info(`  ${C.dim}(No services registered)${C.reset}`);
                    return;
                }

                node.services.forEach((svc: any) => {
                    this.logger.info(`  ${C.cyan}${C.bold}Service: ${svc.name}${C.reset} ${C.dim}v${svc.version || '1.0.0'}${C.reset}`);
                    
                    const tools = svc.tools ? Object.keys(svc.tools) : [];
                    if (tools.length > 0) {
                        this.logger.info(`    ${C.bold}Tools:${C.reset} ${C.dim}${tools.join(', ')}${C.reset}`);
                    }

                    const events = svc.events ? Object.keys(svc.events) : [];
                    if (events.length > 0) {
                        this.logger.info(`    ${C.bold}Events:${C.reset} ${C.dim}${events.join(', ')}${C.reset}`);
                    }
                });
            });
        } else {
            this.logger.info(`\n${C.dim}Hint: Use --verbose to see full service and tool details.${C.reset}`);
        }
        this.logger.info(`${C.dim}================================================================================${C.reset}\n`);
    }

    private formatUptime(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}d ${hours % 24}h`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }
}
