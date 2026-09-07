#!/usr/bin/env node

import { Command } from 'commander';
import { CommandRegistry } from './core/CommandRegistry.js';
import { GenerateCommand } from './commands/GenerateCommand.js';
import { StartCommand } from './commands/StartCommand.js';
import { StatsCommand } from './commands/StatsCommand.js';
import { Logger } from '../utils/Logger.js';
import { LogLevel } from '../interfaces/ILogger.js';

const logger = new Logger(LogLevel.INFO, {}, (level, _fm, originalMsg, ...args) => {
    if (level === LogLevel.ERROR) console.error(originalMsg, ...args);
    else if (level === LogLevel.WARN) console.warn(originalMsg, ...args);
    else console.log(originalMsg, ...args);
});

// Setup CLI Program
const program = new Command();
program
    .name('mesh')
    .description('Mesh Architecture CLI Engine')
    .version('1.0.0')
    .option('-i, --node-id <id>', 'Node identifier (e.g., cli-xxx)')
    .option('-b, --bootstrap <nodes>', 'Comma-separated list of bootstrap node URLs (default: ws://127.0.0.1:5005)')
    .option('-p, --port <number>', 'Port for the WebSocket server to listen on (default: 0 for random)')
    .option('-H, --host <address>', 'Bind address for this one-off client\'s own WebSocket server (default: 0.0.0.0). Set to a private/overlay IP to keep it off any public interface, same reasoning as `mesh start`\'s --host.');

// Initialize Command Registry
const registry = new CommandRegistry();

// Register Built-in Commands
registry.register(new GenerateCommand());
registry.register(new StartCommand());
registry.register(new StatsCommand());

// Attach to Commander
registry.attachToProgram(program);

// Override help to use our PrettyPrinter
program.helpInformation = () => '';
program.on('--help', () => {
    registry.printHelp(program);
});

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * resolveLeafCommand: Walks a Command tree following the leading positional
 * tokens of `args` (e.g. ['secrets', 'set', ...]) to find the actual
 * subcommand that will handle them, mirroring Commander's own subcommand
 * resolution. Stops at the first token that isn't a known subcommand name
 * (an option or a positional arg).
 */
function resolveLeafCommand(program: Command, args: string[]): Command {
    let current = program;
    for (const token of args) {
        if (token.startsWith('-')) break;
        const next = current.commands.find(c => c.name() === token || c.aliases().includes(token));
        if (!next) break;
        current = next;
    }
    return current;
}

/**
 * preprocessArgs: Intercepts and rewrites dot-notation arguments (e.g. --query.status online)
 * into unified JSON record arguments (e.g. --query '{"status":"online"}').
 * This bypasses Commander's strict positional argument checks on schema-less ZodRecord fields.
 *
 * Only applies to dotted flags the resolved subcommand does NOT already have
 * a real, directly-registered option for. `ZodToCliMapper` registers genuine
 * per-field dotted options for plain nested `z.object` schemas (e.g.
 * `secrets.set`'s `--scope.type`/`--scope.id`) -- rewriting those into a
 * single JSON `--scope` blob broke them outright, since no `--scope` option
 * was ever registered for that case (only real `ZodRecord` fields get the
 * single-flag-plus-dot-notation-sugar treatment this function exists for).
 */
function preprocessArgs(args: string[], program: Command): string[] {
    const leaf = resolveLeafCommand(program, args);
    const registeredLongFlags = new Set(leaf.options.map(o => o.long));

    const result: string[] = [];
    const recordGroups: Record<string, Record<string, unknown>> = {};

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;

        if (arg.startsWith('--') && arg.includes('.') && !registeredLongFlags.has(arg.split('=')[0]!)) {
            let keyWithPrefix = '';
            let valStr: string | undefined = undefined;

            if (arg.includes('=')) {
                const parts = arg.split('=');
                keyWithPrefix = parts[0]!;
                valStr = parts.slice(1).join('=');
            } else {
                keyWithPrefix = arg;
                if (i + 1 < args.length && !args[i + 1]!.startsWith('--')) {
                    valStr = args[i + 1];
                    i++;
                }
            }

            const rawKey = keyWithPrefix.substring(2);
            const dotParts = rawKey.split('.');
            const baseOption = dotParts[0]!;
            const subPath = dotParts.slice(1);

            let coercedVal: unknown = valStr;
            if (valStr !== undefined) {
                const trimmed = valStr.trim();
                if (trimmed.toLowerCase() === 'true') {
                    coercedVal = true;
                } else if (trimmed.toLowerCase() === 'false') {
                    coercedVal = false;
                } else if (!isNaN(Number(trimmed)) && trimmed !== '') {
                    coercedVal = Number(trimmed);
                } else if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
                    try { coercedVal = JSON.parse(trimmed); } catch { /* ignore */ }
                }
            }

            if (!recordGroups[baseOption]) {
                recordGroups[baseOption] = {};
            }

            let currentObj = recordGroups[baseOption]!;
            for (let j = 0; j < subPath.length - 1; j++) {
                const p = subPath[j]!;
                if (!currentObj[p] || typeof currentObj[p] !== 'object') {
                    currentObj[p] = {};
                }
                currentObj = currentObj[p] as Record<string, unknown>;
            }
            const lastPart = subPath[subPath.length - 1]!;
            currentObj[lastPart] = coercedVal;
        } else {
            result.push(arg);
        }
    }

    for (const [baseOption, record] of Object.entries(recordGroups)) {
        result.push(`--${baseOption}`, JSON.stringify(record));
    }

    return result;
}

// preprocessArgs needs the full command tree (including generated commands)
// to correctly tell a real registered dotted option apart from ZodRecord
// dot-notation sugar -- computed per-branch below, after generated commands
// are registered wherever that succeeds, so it never runs against a
// half-populated `program`.
const rawArgs = process.argv.slice(2);

// Try to dynamically load the generated commands
try {
    const isExternal = path.resolve(process.cwd()) !== path.resolve(__dirname, '../../..');
    const targetDir = isExternal ? process.cwd() : path.resolve(__dirname, '../..');
    const generatedCommandsPath = path.resolve(targetDir, 'dist/generated/cli/ToolCommands.js');

    // @ts-ignore - Generated files might not exist during first compile
    import(generatedCommandsPath).then((mod) => {
        mod.registerGeneratedCommands(program);

        // Parse args after async load
        const cleanArgs = [...process.argv.slice(0, 2), ...preprocessArgs(rawArgs, program)];
        program.parseAsync(cleanArgs);
    }).catch((err) => {
        // Fallback if generated files don't exist yet
        if (err.code !== 'ERR_MODULE_NOT_FOUND') {
            logger.error("Failed to load generated commands:", err);
        }
        const cleanArgs = [...process.argv.slice(0, 2), ...preprocessArgs(rawArgs, program)];
        program.parse(cleanArgs);
    });
} catch (err) {
    logger.error("Unexpected error loading commands:", err);
    const cleanArgs = [...process.argv.slice(0, 2), ...preprocessArgs(rawArgs, program)];
    program.parse(cleanArgs);
}
