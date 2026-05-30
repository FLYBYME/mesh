#!/usr/bin/env node

import { Command } from 'commander';
import { CommandRegistry } from './core/CommandRegistry.js';
import { GenerateCommand } from './commands/GenerateCommand.js';
import { StartCommand } from './commands/StartCommand.js';
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
    .option('-p, --port <number>', 'Port for the WebSocket server to listen on (default: 0 for random)');

// Initialize Command Registry
const registry = new CommandRegistry();

// Register Built-in Commands
registry.register(new GenerateCommand());
registry.register(new StartCommand());

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
 * preprocessArgs: Intercepts and rewrites dot-notation arguments (e.g. --query.status online)
 * into unified JSON record arguments (e.g. --query '{"status":"online"}').
 * This bypasses Commander's strict positional argument checks on schema-less ZodRecord fields.
 */
function preprocessArgs(args: string[]): string[] {
    const result: string[] = [];
    const recordGroups: Record<string, Record<string, unknown>> = {};

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;

        if (arg.startsWith('--') && arg.includes('.')) {
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

const cleanArgs = [
    ...process.argv.slice(0, 2),
    ...preprocessArgs(process.argv.slice(2))
];

// Try to dynamically load the generated commands
try {
    const isExternal = path.resolve(process.cwd()) !== path.resolve(__dirname, '../../..');
    const targetDir = isExternal ? process.cwd() : path.resolve(__dirname, '../..');
    const generatedCommandsPath = path.resolve(targetDir, 'src/generated/cli/ToolCommands.js');
    
    // @ts-ignore - Generated files might not exist during first compile
    import(generatedCommandsPath).then((mod) => {
        mod.registerGeneratedCommands(program);
        
        // Parse args after async load
        program.parseAsync(cleanArgs);
    }).catch((err) => {
        // Fallback if generated files don't exist yet
        if (err.code !== 'ERR_MODULE_NOT_FOUND') {
            logger.error("Failed to load generated commands:", err);
        }
        program.parse(cleanArgs);
    });
} catch (err) {
    logger.error("Unexpected error loading commands:", err);
    program.parse(cleanArgs);
}
