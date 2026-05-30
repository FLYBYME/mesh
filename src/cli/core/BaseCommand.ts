import { Command as CommanderCommand } from 'commander';
import { ILogger } from '../../interfaces/ILogger.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';

export abstract class BaseCommand {
    public abstract readonly name: string;
    public abstract readonly description: string;
    public readonly aliases: string[] = [];
    public readonly category: string = 'General';

    protected logger: ILogger = new Logger(LogLevel.INFO, {}, (level, formattedMsg, originalMsg, ...args) => {
        // For CLI tools, we prefer clean output without timestamps by default
        if (level === LogLevel.ERROR) console.error(originalMsg, ...args);
        else if (level === LogLevel.WARN) console.warn(originalMsg, ...args);
        else console.log(originalMsg, ...args);
    });

    /**
     * Registers the command with Commander.
     */
    public abstract register(program: CommanderCommand): void;

    /**
     * The main execution logic of the command.
     */
    protected abstract execute(...args: unknown[]): Promise<void>;
}
