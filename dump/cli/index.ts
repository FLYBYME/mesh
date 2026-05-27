#!/usr/bin/env node
import { Command } from 'commander';
import { CommandRegistry } from './core/CommandRegistry';
import { GenerateCommand } from './commands/GenerateCommand';

async function bootstrap() {
    const program = new Command();
    program
        .name('mesh')
        .description('Mesh Architecture CLI')
        .version('1.0.0');

    // Add global options
    program.option('--url <url>', 'Server URL', 'http://localhost:3000/api/v2');

    const registry = new CommandRegistry();
    
    // Register commands
    registry.register(new GenerateCommand());

    // Attach to Commander
    registry.attachToProgram(program);

    // Override help to use our Pretty Help
    program.configureHelp({
        formatHelp: (cmd, helper) => {
            registry.printHelp(cmd);
            return ''; // We handle printing ourselves
        }
    });

    await program.parseAsync(process.argv);
}

bootstrap().catch((err) => {
    console.error('CLI Error:', err);
    process.exit(1);
});
