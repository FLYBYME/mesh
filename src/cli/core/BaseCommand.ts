import { Command as CommanderCommand } from 'commander';

export abstract class BaseCommand {
    public abstract readonly name: string;
    public abstract readonly description: string;
    public readonly aliases: string[] = [];
    public readonly category: string = 'General';

    /**
     * Registers the command with Commander.
     */
    public abstract register(program: CommanderCommand): void;

    /**
     * The main execution logic of the command.
     */
    protected abstract execute(...args: unknown[]): Promise<void>;
}
