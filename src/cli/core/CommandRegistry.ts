import { Command as CommanderCommand } from 'commander';
import { BaseCommand } from './BaseCommand.js';
import { C } from './Utils.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';

export class CommandRegistry {
    private commands: BaseCommand[] = [];
    private logger = new Logger(LogLevel.INFO, {}, (level, _fm, originalMsg, ...args) => {
        if (level === LogLevel.ERROR) console.error(originalMsg, ...args);
        else if (level === LogLevel.WARN) console.warn(originalMsg, ...args);
        else console.log(originalMsg, ...args);
    });

    public register(command: BaseCommand): void {
        this.commands.push(command);
    }

    public attachToProgram(program: CommanderCommand): void {
        for (const cmd of this.commands) {
            cmd.register(program);
        }
    }

    public getCommandsByCategory(): Map<string, BaseCommand[]> {
        const groups = new Map<string, BaseCommand[]>();
        for (const cmd of this.commands) {
            if (!groups.has(cmd.category)) {
                groups.set(cmd.category, []);
            }
            const group = groups.get(cmd.category);
            if (group) group.push(cmd);
        }
        return groups;
    }

    public printHelp(program?: CommanderCommand): void {
        const groups = this.getCommandsByCategory();
        this.logger.info(`\n${C.magenta}${C.bold}MESH CLI${C.reset}\n`);

        for (const [category, commands] of groups) {
            this.logger.info(`${C.blue}${C.bold}${category}${C.reset}`);
            for (const cmd of commands) {
                const aliases = cmd.aliases.length ? ` ${C.dim}(${cmd.aliases.join(', ')})${C.reset}` : '';
                this.logger.info(`  ${C.cyan}${C.bold}${cmd.name.padEnd(18)}${C.reset}${aliases} ${C.dim}${cmd.description}${C.reset}`);
            }
            this.logger.info('');
        }

        // Print generated commands from Commander that aren't in the registry
        if (program) {
            const registryCommandNames = new Set(this.commands.map(c => c.name));
            const externalCommands = program.commands.filter(c => !registryCommandNames.has(c.name()) && c.name() !== 'help');

            if (externalCommands.length > 0) {
                this.logger.info(`${C.blue}${C.bold}Tools${C.reset}`);
                for (const cmd of externalCommands) {
                    this.logger.info(`  ${C.cyan}${C.bold}${cmd.name().padEnd(18)}${C.reset} ${C.dim}${cmd.description()}${C.reset}`);
                    for (const sub of cmd.commands) {
                        this.logger.info(`    ${C.cyan}${sub.name().padEnd(16)}${C.reset} ${C.dim}${sub.description()}${C.reset}`);
                    }
                    this.logger.info('');
                }
            }
        }
    }
}
