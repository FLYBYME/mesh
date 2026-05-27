#!/usr/bin/env node
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cliPath = path.join(__dirname, '../src/cli/index.ts');

const result = spawnSync('npx', ['tsx', cliPath, ...process.argv.slice(2)], {
    stdio: 'inherit'
});

process.exit(result.status ?? 0);
