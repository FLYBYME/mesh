import { Command } from 'commander';
import { BaseCommand } from '../core/BaseCommand.js';
import fs from 'fs';
import path from 'path';
import * as esbuild from 'esbuild';

interface ContractDiscovery {
    exportName: string;
    domain: string;
    action: string;
    description: string;
    method: string;
    path: string;
    isStream: boolean;
}

interface EventDiscovery {
    exportName: string;
    name: string; // The event string (e.g., 'demo.hello.sent')
    schemaRef: string;
}

/**
 * GenerateCommand: Core Generator for Mesh Architecture.
 */
export class GenerateCommand extends BaseCommand {
    public readonly name = 'generate';
    public readonly description = 'Generate strictly-typed artifacts (SDK, CLI, Context API, Events).';
    public readonly category = 'System Tools';

    private readonly artifactRoot = path.resolve('./src/generated');

    public register(program: Command): void {
        program
            .command(this.name)
            .description(this.description)
            .option('--dir <dir>', 'Directory to scan for contracts', './src')
            .option('-i, --include <paths...>', 'Relative paths to external generated api.ts files to include in this project\'s types')
            .action(async (options: { dir?: string, include?: string[] }) => {
                await this.execute(options);
            });
    }

    protected async execute(options: { dir?: string, include?: string[] } = {}): Promise<void> {
        const scanDir = path.resolve(options.dir || './src');
        if (!fs.existsSync(scanDir)) {
            throw new Error(`Directory not found: ${scanDir}`);
        }

        this.logger.info(`--- Generating Mesh Artifacts from ${scanDir} ---`);
        const start = Date.now();

        if (!fs.existsSync(this.artifactRoot)) {
            fs.mkdirSync(this.artifactRoot, { recursive: true });
        }

        const { discovery, events, files } = this.discoverContractsAndEvents([scanDir]);

        await this.generateToolRegistry(discovery, files, options.include || []);
        await this.generateCLI(discovery, files);
        await this.generateEvents(events, files, options.include || []);
        
        await this.bundleBrowser();

        console.log('\n--- Generation Complete ---');
        const end = Date.now();
        console.log(`Generation completed in ${(end - start) / 1000} seconds`);
    }

    private async bundleBrowser(): Promise<void> {
        const pkg = JSON.parse(fs.readFileSync(path.resolve('./package.json'), 'utf-8'));
        if (pkg.name !== 'mesh') return;
        this.logger.info('Bundling Browser Version with esbuild...');
        const browserEntry = path.resolve('./src/browser.ts');
        if (!fs.existsSync(browserEntry)) {
            this.logger.info('Skipping browser bundle: src/browser.ts not found.');
            return;
        }

        const outDir = path.resolve('./dist');
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }

        try {
            await esbuild.build({
                entryPoints: [browserEntry],
                bundle: true,
                outfile: path.join(outDir, 'mesh.browser.js'),
                format: 'esm',
                platform: 'browser',
                sourcemap: true,
                minify: true,
                target: 'es2020',
                external: ['mongodb', 'ws', 'express', 'nats'],
                logOverride: {
                    'direct-eval': 'silent'
                }
            });
            this.logger.info(`Browser bundle written to dist/mesh.browser.js`);
        } catch (e) {
            this.logger.error('Failed to bundle browser version:', e);
            throw e;
        }
    }

    private async generateToolRegistry(discovery: ContractDiscovery[], files: Record<string, string[]>, includes: string[]): Promise<void> {
        this.logger.info('Generating IServiceToolRegistry augmentation...');
        const filePath = path.join(this.artifactRoot, 'api.ts');
        const aliasMap = this.getAliasMap(files, this.artifactRoot);
        const pkg = JSON.parse(fs.readFileSync(path.resolve('./package.json'), 'utf-8'));
        const isExternal = pkg.name !== 'mesh';
        const interfaceImport = isExternal ? 'mesh' : '../interfaces/IServiceContext.js';

        let code = `// GENERATED FILE - DO NOT EDIT\n`;
        code += `import { z } from 'zod';\n`;
        code += `import type { IServiceToolRegistry } from '${interfaceImport}';\n`;
        
        // --- External Imports ---
        if (includes.length > 0) {
            code += `\n// External Type Includes\n`;
            for (const includePath of includes) {
                // Determine relative path from artifact root to the included file
                const absoluteInclude = path.resolve(includePath);
                let rel = path.relative(this.artifactRoot, absoluteInclude).replace(/\\/g, '/');
                if (!rel.startsWith('.')) rel = './' + rel;
                code += `import '${rel}';\n`;
            }
        }

        Object.values(aliasMap).forEach(m => {
            code += `import * as ${m.alias} from '${m.path}';\n`;
        });

        code += `\ndeclare module '${interfaceImport}' {\n`;
        code += `    interface IServiceToolRegistry {\n`;

        for (const m of discovery) {
            const domainFiles = files[m.domain];
            if (!domainFiles || domainFiles.length === 0) continue;
            const alias = aliasMap[domainFiles[0]!]?.alias;
            if (!alias) continue;

            let inputType = 'unknown', outputType = 'unknown';

            if (m.exportName.includes('.')) {
                const [c, k] = m.exportName.split('.');
                inputType = `z.input<typeof ${alias}.${c}['${k}']['inputSchema']>`;
                outputType = `z.infer<typeof ${alias}.${c}['${k}']['outputSchema']>`;
            } else {
                inputType = `z.input<typeof ${alias}.${m.exportName}['inputSchema']>`;
                outputType = `z.infer<typeof ${alias}.${m.exportName}['outputSchema']>`;
            }

            code += `        '${m.domain}.${m.action}': { params: ${inputType}, returns: ${outputType} };\n`;
        }

        code += `    }\n}\n`;
        code += `\nexport type { IServiceToolRegistry };\n`;
        fs.writeFileSync(filePath, code);
    }

    private async generateEvents(events: EventDiscovery[], files: Record<string, string[]>, includes: string[]): Promise<void> {
        console.log('Generating EventRegistry augmentation...');
        const filePath = path.join(this.artifactRoot, 'events.ts');
        const aliasMap = this.getAliasMap(files, this.artifactRoot);
        const pkg = JSON.parse(fs.readFileSync(path.resolve('./package.json'), 'utf-8'));
        const isExternal = pkg.name !== 'mesh';
        const interfaceImport = isExternal ? 'mesh' : '../interfaces/IEventContract.js';

        let code = `// GENERATED FILE - DO NOT EDIT\n`;
        code += `import { z } from 'zod';\n`;
        code += `import type { EventRegistry } from '${interfaceImport}';\n`;

        // --- External Imports ---
        if (includes.length > 0) {
            code += `\n// External Type Includes\n`;
            for (const includePath of includes) {
                // Target the events.ts file if it exists, otherwise assume api.ts handles it or it's a direct path
                let target = includePath;
                if (includePath.endsWith('api.ts') || includePath.endsWith('api.js')) {
                    target = includePath.replace(/api\.(ts|js)$/, 'events.$1');
                }
                
                if (fs.existsSync(path.resolve(target))) {
                    const absoluteInclude = path.resolve(target);
                    let rel = path.relative(this.artifactRoot, absoluteInclude).replace(/\\/g, '/');
                    if (!rel.startsWith('.')) rel = './' + rel;
                    code += `import '${rel}';\n`;
                }
            }
        }

        Object.values(aliasMap).forEach(m => {
            code += `import * as ${m.alias} from '${m.path}';\n`;
        });

        code += `\ndeclare module '${interfaceImport}' {\n`;
        code += `    interface EventRegistry {\n`;

        for (const e of events) {
            const fileKeys = Object.keys(files);
            let alias = '';
            // Find which file contains this event export
            for (const domain of fileKeys) {
                const dfiles = files[domain];
                if (!dfiles) continue;
                for (const f of dfiles) {
                    const content = fs.readFileSync(f, 'utf-8');
                    if (content.includes(`export const ${e.exportName}`)) {
                        alias = aliasMap[f]!.alias;
                        break;
                    }
                }
                if (alias) break;
            }

            if (alias) {
                const schemaType = `typeof ${alias}.${e.exportName}['schema']`;
                code += `        '${e.name}': z.infer<${schemaType}>;\n`;
            }
        }

        code += `    }\n}\n`;
        code += `\nexport type { EventRegistry };\n`;
        fs.writeFileSync(filePath, code);
    }

    private async generateCLI(discovery: ContractDiscovery[], files: Record<string, string[]>): Promise<void> {
        const pkg = JSON.parse(fs.readFileSync(path.resolve('./package.json'), 'utf-8'));
        const isExternal = pkg.name !== 'mesh';
        this.logger.info('Generating CLI Command Tree...');
        const outDir = path.join(this.artifactRoot, 'cli');
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        const filePath = path.join(outDir, 'ToolCommands.ts');

        const aliasMap = this.getAliasMap(files, outDir);

        let importBlock = '';
        Object.values(aliasMap).forEach(m => {
            importBlock += `import * as ${m.alias} from '${m.path}';\n`;
        });

        let code = `// GENERATED FILE - DO NOT EDIT\n`;
        code += `import { Command } from 'commander';\n`;
        if (isExternal) {
            code += `import { MeshApp, ZodToCliMapper, C, RegistryModule, NetworkModule, BrokerModule, WSTransport, JSONSerializer, Logger } from 'mesh';\n`;
        } else {
            code += `import { MeshApp } from '../../core/MeshApp.js';\n`;
            code += `import { ZodToCliMapper } from '../../cli/core/ZodToCliMapper.js';\n`;
            code += `import { C } from '../../cli/core/Utils.js';\n`;
            code += `import { RegistryModule } from '../../modules/RegistryModule.js';\n`;
            code += `import { NetworkModule } from '../../modules/NetworkModule.js';\n`;
            code += `import { BrokerModule } from '../../modules/BrokerModule.js';\n`;
            code += `import { WSTransport } from '../../transports/node/WSTransport.js';\n`;
            code += `import { JSONSerializer } from '../../serializers/JSONSerializer.js';\n`;
            code += `import { Logger } from '../../utils/Logger.js';\n`;
        }
        code += `${importBlock}\n`;

        // Execution helper
        code += `async function executeCommand(toolName: string, args: Record<string, unknown>, contract: any, options: any) {\n`;
        code += `    const logger = new Logger(3); // Error level to avoid cluttering CLI output\n`;
        code += `    const nodeId = options.nodeId || \`cli-\${Math.random().toString(36).substring(2, 9)}\`;\n`;
        code += `    const app = new MeshApp({ nodeID: nodeId, logger });\n`;
        code += `    const serializer = new JSONSerializer();\n`;
        code += `    const port = parseInt(options.port || '0', 10);\n`;
        code += `    const wsTransport = new WSTransport(serializer, port);\n`;
        code += `    \n`;
        code += `    const bootstrapStr = options.bootstrap || 'ws://127.0.0.1:5005';\n`;
        code += `    app.use(new RegistryModule());\n`;
        code += `    app.use(new NetworkModule({\n`;
        code += `        port,\n`;
        code += `        transports: [wsTransport] as any,\n`;
        code += `        bootstrapNodes: bootstrapStr ? bootstrapStr.split(',').map((s: string) => s.trim()) : []\n`;
        code += `    }));\n`;
        code += `    app.use(new BrokerModule());\n\n`;
        code += `    await app.start();\n`;
        code += `    \n`;
        code += `    // Wait briefly for discovery if bootstrap is provided\n`;
        code += `    if (bootstrapStr) {\n`;
        code += `        await new Promise(r => setTimeout(r, 2000)); // wait for registry sync (PEX)\n`;
        code += `    }\n\n`;
        code += `    try {\n`;
        code += `        console.log(C.dim + \`Executing \${toolName}...\` + C.reset);\n`;
        code += `        const res = await app.call(toolName as any, ZodToCliMapper.parseOptions(args, contract.inputSchema) as any, { timeout: 300000 });\n`;
        code += `        console.log(contract.print(res));\n`;
        code += `    } finally {\n`;
        code += `        await app.stop();\n`;
        code += `    }\n`;
        code += `}\n\n`;

        code += `export function registerGeneratedCommands(program: Command) {\n`;

        const byDomain: Record<string, ContractDiscovery[]> = {};
        discovery.forEach(d => {
            if (!byDomain[d.domain]) byDomain[d.domain] = [];
            byDomain[d.domain].push(d);
        });

        for (const [domain, methods] of Object.entries(byDomain)) {
            code += `    const ${domain} = program.command('${domain}').description('${domain} tools');\n`;
            for (const m of methods) {
                const alias = aliasMap[files[domain]![0]!]!.alias;
                let inputSchema = '';
                let contractRef = '';
                if (m.exportName.includes('.')) {
                    const [c, k] = m.exportName.split('.');
                    inputSchema = `${alias}.${c}['${k}'].inputSchema`;
                    contractRef = `${alias}.${c}['${k}']`;
                } else {
                    inputSchema = `${alias}.${m.exportName}.inputSchema`;
                    contractRef = `${alias}.${m.exportName}`;
                }

                const safeVarName = `${domain}_${m.exportName}_${m.action}`.replace(/[^a-zA-Z0-9_]/g, '_');
                code += `    const cmd_${safeVarName} = ${domain}.command('${m.action}').description(\`${m.description}\`);\n`;
                code += `    cmd_${safeVarName}.action(async (o: Record<string, unknown>, cmd: Command) => {\n`;
                code += `        try {\n`;
                code += `            await executeCommand('${domain}.${m.action}', o, ${contractRef}, cmd.optsWithGlobals());\n`;
                code += `            process.exit(0);\n`;
                code += `        } catch (err: unknown) {\n`;
                code += `            const message = err instanceof Error ? err.message : String(err);\n`;
                code += `            console.error(C.red + 'Error:' + C.reset, message);\n`;
                code += `            process.exit(1);\n`;
                code += `        }\n`;
                code += `    });\n`;
                code += `    ZodToCliMapper.applyOptions(cmd_${safeVarName}, ${inputSchema});\n`;
            }
        }
        code += `}\n`;
        fs.writeFileSync(filePath, code);
    }

    private discoverContractsAndEvents(dirsToScan: string[]): { discovery: ContractDiscovery[], events: EventDiscovery[], files: Record<string, string[]> } {
        const allContracts: ContractDiscovery[] = [];
        const allEvents: EventDiscovery[] = [];
        const domainFiles: Record<string, string[]> = {};

        const files: string[] = [];
        for (const dir of dirsToScan) {
            if (fs.existsSync(dir)) {
                files.push(...this.walkDir(dir).filter(f => f.endsWith('.contract.ts')));
            }
        }

        for (const file of files) {
            const content = fs.readFileSync(file, 'utf-8');

            // 1. Find defineContract
            const contractMatches = content.matchAll(/export\s+const\s+(\w+)\s*=\s*defineContract\(\{([\s\S]*?)\}\);/g);
            for (const match of contractMatches) {
                const exportName = match[1]!;
                const body = match[2]!;

                const domainMatch = /\bdomain:\s*['"]([^'"]+)['"]/.exec(body);
                const actionMatch = /\baction:\s*['"]([^'"]+)['"]/.exec(body);
                const descMatch = /\bdescription:\s*['"]([^'"]+)['"]/.exec(body) || /\bdescription:\s*`([\s\S]*?)`/.exec(body);
                const restMatch = /\brest:\s*\{([\s\S]*?)\}/.exec(body);

                let method = 'POST';
                let pathStr = '/';
                let isStream = false;

                if (restMatch) {
                    const restBody = restMatch[1]!;
                    const m = /\bmethod:\s*['"]([^'"]+)['"]/.exec(restBody);
                    const p = /\bpath:\s*['"]([^'"]+)['"]/.exec(restBody);
                    const s = /\bisStream:\s*(true|false)/.exec(restBody);
                    if (m) method = m[1]!;
                    if (p) pathStr = p[1]!;
                    if (s) isStream = s[1] === 'true';
                }

                if (domainMatch && actionMatch) {
                    const domain = domainMatch[1]!;
                    const action = actionMatch[1]!;
                    
                    if (domain.includes('_')) throw new Error(`Domain "${domain}" cannot contain underscores (File: ${file})`);

                    if (!domainFiles[domain]) domainFiles[domain] = [];
                    if (!domainFiles[domain].includes(file)) domainFiles[domain].push(file);

                    allContracts.push({
                        exportName,
                        domain,
                        action,
                        description: descMatch ? (descMatch[1] || descMatch[2] || '') : '',
                        method,
                        path: pathStr,
                        isStream
                    });
                }
            }

            // 2. Find defineCrud
            const crudMatches = content.matchAll(/export\s+const\s+(\w+)\s*=\s*defineCrud\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)/g);
            for (const match of crudMatches) {
                const exportName = match[1]!;
                const domain = match[2]!;
                
                if (domain.includes('_')) throw new Error(`Domain "${domain}" cannot contain underscores (File: ${file})`);

                const actions = {
                    create: 'create',
                    find: 'find',
                    findOne: 'find_one',
                    count: 'count',
                    get: 'get',
                    update: 'update',
                    delete: 'delete'
                };

                if (!domainFiles[domain]) domainFiles[domain] = [];
                if (!domainFiles[domain].includes(file)) domainFiles[domain].push(file);

                Object.entries(actions).forEach(([key, action]) => {
                    allContracts.push({
                        exportName: `${exportName}.${key}`,
                        domain,
                        action,
                        description: `CRUD ${key} for ${domain} (${exportName})`,
                        method: 'POST',
                        path: `/${domain}/${action}`,
                        isStream: false
                    });
                });
            }

            // 3. Find defineTimeSeries
            const tsMatches = content.matchAll(/export\s+const\s+(\w+)\s*=\s*defineTimeSeries\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)/g);
            for (const match of tsMatches) {
                const exportName = match[1]!;
                const domain = match[2]!;
                
                if (domain.includes('_')) throw new Error(`Domain "${domain}" cannot contain underscores (File: ${file})`);

                const actions = {
                    insert: 'insert',
                    query: 'query',
                    aggregate: 'aggregate',
                    latest: 'latest'
                };

                if (!domainFiles[domain]) domainFiles[domain] = [];
                if (!domainFiles[domain].includes(file)) domainFiles[domain].push(file);

                Object.entries(actions).forEach(([key, action]) => {
                    allContracts.push({
                        exportName: `${exportName}.${key}`,
                        domain,
                        action,
                        description: `Time Series ${key} for ${domain} (${exportName})`,
                        method: 'POST',
                        path: `/${domain}/${action}`,
                        isStream: false
                    });
                });
            }

            // 4. Find defineEvent
            const eventMatches = content.matchAll(/export\s+const\s+(\w+)\s*=\s*defineEvent\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)/g);
            for (const match of eventMatches) {
                const exportName = match[1]!;
                const eventName = match[2]!;
                const schemaRef = match[3]!;
                
                // Add this file to a 'global_events' domain pseudo-bucket so we get an alias for it
                if (!domainFiles['global_events']) domainFiles['global_events'] = [];
                if (!domainFiles['global_events'].includes(file)) domainFiles['global_events'].push(file);

                allEvents.push({
                    exportName,
                    name: eventName,
                    schemaRef
                });
            }
        }
        return { discovery: allContracts, events: allEvents, files: domainFiles };
    }

    private walkDir(dir: string): string[] {
        let results: string[] = [];
        const list = fs.readdirSync(dir);
        list.forEach((file) => {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            if (stat && stat.isDirectory()) {
                results = results.concat(this.walkDir(filePath));
            } else {
                results.push(filePath);
            }
        });
        return results;
    }

    private getAliasMap(files: Record<string, string[]>, targetDir: string): Record<string, { alias: string, path: string }> {
        const allFiles = Array.from(new Set(Object.values(files).flat()));
        const map: Record<string, { alias: string, path: string }> = {};

        allFiles.forEach((file, idx) => {
            let importPath = path.relative(targetDir, file).replace(/\\/g, '/').replace(/\.ts$/, '.js');
            if (!importPath.startsWith('.')) {
                importPath = './' + importPath;
            }
            map[file] = {
                alias: `Contract_${idx}`,
                path: importPath
            };
        });
        return map;
    }
}
