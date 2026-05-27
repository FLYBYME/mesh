import { Command } from 'commander';
import { BaseCommand } from '../core/BaseCommand';
import { Codegen } from '../../codegen/Codegen';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

/**
 * GenerateCommand: Exposes the Mesh Codegen engine to the CLI.
 */
export class GenerateCommand extends BaseCommand {
    public readonly name = 'generate';
    public readonly description = 'Generate strictly-typed artifacts (SDK, CLI, Context API) from Mesh contracts.';
    public readonly category = 'System Tools';

    public register(program: Command): void {
        program
            .command(this.name)
            .description(this.description)
            .option('--skip-tsc', 'Skip the TypeScript compiler diagnostics check')
            .option('--addons <dir>', 'Directory to load contracts/services from', '.')
            .action(async (options: { skipTsc?: boolean; addons?: string }) => {
                await this.execute(options);
            });
    }

    protected async execute(options: { skipTsc?: boolean; addons?: string } = {}): Promise<void> {
        if (!options.addons) {
            throw new Error('No addons directory provided');
        }

        const outDir = './src/generated';
        const codegen = new Codegen(outDir);
        await codegen.execute([options.addons]);

        if (!options.skipTsc) {
            console.log('\n--- Running TypeScript compiler ---');
            try {
                execSync('npx tsc --noEmit', { cwd: path.resolve('.'), stdio: 'inherit' });
                console.log('✔ Diagnostics complete (no errors found).');
            } catch (err) {
                console.error('✔ Diagnostics complete (errors found).');
            }
        } else {
            console.log('\n--- Skipping TypeScript diagnostics (requested) ---');
        }
    }
}
