#!/usr/bin/env node
import path from 'path';
import { fileURLToPath } from 'url';
import "dotenv/config";
import { fork } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Target the compiled entry point
const cliPath = path.resolve(__dirname, '../dist/cli/index.js');

const cp = fork(cliPath, process.argv.slice(2), {
    stdio: 'inherit'
});

cp.on('exit', (code) => {
    process.exit(code ?? 0);
});
