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
    filePath: string;
}

/**
 * Turn the *source text* of a string literal back into the value it denotes.
 *
 * Descriptions are read by matching source rather than by parsing it, so what comes back is what was
 * typed: `a site\'s parts`, with the backslash still in it. Emitting that verbatim is how a value
 * ending in a backslash escapes the delimiter of whatever literal it is written into.
 *
 * Only the escapes that appear in hand-written prose are handled. A description written with a
 * numeric or unicode escape is not a case worth a parser for.
 */
export function unescapeStringLiteral(raw: string): string {
    return raw.replace(/\\(.)/g, (_, char: string) => {
        switch (char) {
            case 'n': return '\n';
            case 't': return '\t';
            case 'r': return '\r';
            // `\'`, `\"`, `` \` `` and `\\` all denote the character itself.
            default: return char;
        }
    });
}

/**
 * A template literal that safely holds arbitrary text.
 *
 * Three characters can escape a template literal, and all three occur in ordinary prose: a backtick,
 * a backslash, and `${`. Escaping them here is what makes the emitted file parse regardless of what
 * a contract author wrote — the check that does not depend on remembering a rule.
 */
export function toTemplateLiteral(value: string): string {
    const escaped = value
        .replace(/\\/g, '\\\\')
        .replace(/`/g, '\\`')
        .replace(/\$\{/g, '\\${');
    return `\`${escaped}\``;
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
            .option('-I, --include <paths...>', 'Paths or Package Names of external generated api.ts files to include in this project\'s types')
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
        await this.generateEvents(events, discovery, files, options.include || []);

        await this.bundleBrowser();

        this.logger.info('--- Generation Complete ---');
        const end = Date.now();
        this.logger.info(`Generation completed in ${(end - start) / 1000} seconds`);
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
        const isExternal = pkg.name !== '@flybyme/mesh';

        let code = `// GENERATED FILE - DO NOT EDIT\n`;
        code += `import { z } from 'zod';\n`;

        if (includes.length > 0) {
            code += `\n// External Type Includes\n`;
            for (const includePath of includes) {
                if (!includePath.startsWith('.') && !includePath.startsWith('/') && !includePath.includes('\\')) {
                    code += `import '${includePath}';\n`;
                } else {
                    const absoluteInclude = path.resolve(includePath);
                    let rel = path.relative(this.artifactRoot, absoluteInclude).replace(/\\/g, '/');
                    if (!rel.startsWith('.')) rel = './' + rel;
                    code += `import '${rel}';\n`;
                }
            }
        }

        Object.values(aliasMap).forEach(m => {
            code += `import * as ${m.alias} from '${m.path}';\n`;
        });

        code += `\ndeclare global {\n`;
        code += `    interface IServiceToolRegistry {\n`;

        const seenTools = new Set<string>();
        for (const m of discovery) {
            const toolKey = `${m.domain}.${m.action}`;
            if (seenTools.has(toolKey)) continue;
            seenTools.add(toolKey);

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

    private async generateEvents(events: EventDiscovery[], discovery: ContractDiscovery[], files: Record<string, string[]>, includes: string[]): Promise<void> {
        this.logger.info('Generating EventRegistry augmentation...');
        const filePath = path.join(this.artifactRoot, 'events.ts');
        const aliasMap = this.getAliasMap(files, this.artifactRoot);

        let code = `// GENERATED FILE - DO NOT EDIT\n`;
        code += `import { z } from 'zod';\n`;

        if (includes.length > 0) {
            code += `\n// External Type Includes\n`;
            for (const includePath of includes) {
                if (!includePath.startsWith('.') && !includePath.startsWith('/') && !includePath.includes('\\')) {
                    code += `import '${includePath}';\n`;
                    continue;
                }

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

        code += `\ndeclare global {\n`;
        code += `    interface EventRegistry {\n`;

        for (const e of events) {
            const fileMapping = aliasMap[e.filePath];
            if (fileMapping) {
                const schemaType = `typeof ${fileMapping.alias}.${e.exportName}['schema']`;
                code += `        '${e.name}': z.infer<${schemaType}>;\n`;
            }
        }

        // Additive, backward-compatible companions to the generic `data.created`/
        // `data.updated`/`data.deleted` events every CRUD write already fires (see
        // DatabaseMiddleware.ts's `emitNamed`) -- one `<domain>.created`/`.updated`/
        // `.deleted` entry per CRUD-mounted domain, typed off that domain's own
        // create/update contract schemas rather than the generic `data.*` shape.
        const namedCrudEvents = new Set<string>();
        for (const m of discovery) {
            if (!['create', 'update', 'delete'].includes(m.action)) continue;
            if (!m.exportName.includes('.')) continue; // only CRUD-derived entries are dotted
            if (namedCrudEvents.has(m.domain)) continue;

            const domainFiles = files[m.domain];
            if (!domainFiles || domainFiles.length === 0) continue;
            const alias = aliasMap[domainFiles[0]!]?.alias;
            if (!alias) continue;

            const [crudExport] = m.exportName.split('.');
            namedCrudEvents.add(m.domain);

            const createdType = `z.infer<typeof ${alias}.${crudExport}['create']['outputSchema']>`;
            const updatedItemType = `z.infer<typeof ${alias}.${crudExport}['update']['outputSchema']>`;

            code += `        '${m.domain}.created': ${createdType};\n`;
            code += `        '${m.domain}.updated': { id: string; patch: Record<string, unknown>; item: ${updatedItemType} };\n`;
            code += `        '${m.domain}.deleted': { id: string };\n`;
        }

        code += `    }\n}\n`;
        code += `\nexport type { EventRegistry };\n`;
        fs.writeFileSync(filePath, code);
    }

    private async generateCLI(discovery: ContractDiscovery[], files: Record<string, string[]>): Promise<void> {
        const pkg = JSON.parse(fs.readFileSync(path.resolve('./package.json'), 'utf-8'));
        const isExternal = pkg.name !== '@flybyme/mesh';
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
            code += `import { MeshApp, C, RegistryModule, NetworkModule, BrokerModule, JSONSerializer, Logger } from '@flybyme/mesh';\n`;
            code += `import { WSTransport, ZodToCliMapper } from '@flybyme/mesh/node';\n`;
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

        code += `async function executeCommand(toolName: string, args: Record<string, unknown>, contract: any, options: any) {\n`;
        code += `    const logger = new Logger(3);\n`;
        code += `    const nodeId = options.nodeId || \`cli-\${Math.random().toString(36).substring(2, 9)}\`;\n`;
        code += `    const app = new MeshApp({ nodeID: nodeId, logger });\n`;
        code += `    const serializer = new JSONSerializer();\n`;
        code += `    const port = parseInt(options.port || '0', 10);\n`;
        code += `    const host = options.host || '0.0.0.0';\n`;
        code += `    const wsTransport = new WSTransport(serializer, port, host);\n`;
        code += `    \n`;
        code += `    const bootstrapStr = options.bootstrap || 'ws://127.0.0.1:5005';\n`;
        code += `    app.use(new RegistryModule());\n`;
        code += `    app.use(new NetworkModule({\n`;
        code += `        port,\n`;
        code += `        transports: [wsTransport],\n`;
        code += `        bootstrapNodes: bootstrapStr ? bootstrapStr.split(',').map((s: string) => s.trim()) : []\n`;
        code += `    }));\n`;
        code += `    app.use(new BrokerModule());\n\n`;
        code += `    await app.start();\n`;
        code += `    \n`;
        code += `    if (bootstrapStr) {\n`;
        code += `        // Wait for the actual tool to become resolvable (event-driven, via\n`;
        code += `        // Registry's own 'changed' event -- see Registry.waitForTool) instead of\n`;
        code += `        // a blind fixed sleep. A hardcoded 2000ms guess raced peer-exchange sync\n`;
        code += `        // on any connection slower than a fast local/LAN path (found for real over\n`;
        code += `        // a higher-latency tunnel: 'Local tool not found' with an empty registry,\n`;
        code += `        // even though the peer had genuinely connected -- PEX just hadn't finished\n`;
        code += `        // propagating yet). 15s ceiling matches waitForTool's own default.\n`;
        code += `        try {\n`;
        code += `            await app.registry.waitForTool(toolName, 15000);\n`;
        code += `        } catch {\n`;
        code += `            // Let the real call fail with its own real error below rather than\n`;
        code += `            // failing here on a timeout that may itself be stale.\n`;
        code += `        }\n`;
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
            const seenActions = new Set<string>();
            for (const m of methods) {
                if (seenActions.has(m.action)) continue;
                seenActions.add(m.action);

                const domainFiles = files[domain];
                if (!domainFiles || domainFiles.length === 0) continue;
                const alias = aliasMap[domainFiles[0]!]?.alias;
                if (!alias) continue;

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
                // Escaped, not interpolated raw. A description is arbitrary prose from a contract
                // author and may contain a backtick, a `${`, or a backslash — any of which silently
                // produces a file that does not parse, with every reported error landing in whatever
                // command happens to follow rather than in the one that caused it.
                code += `    const cmd_${safeVarName} = ${domain}.command('${m.action}').description(${toTemplateLiteral(m.description)});\n`;
                code += `    cmd_${safeVarName}.action(async (o: Record<string, unknown>, cmd: Command) => {\n`;
                code += `        try {\n`;
                code += `            await executeCommand('${domain}.${m.action}', o, ${contractRef}, cmd.optsWithGlobals());\n`;
                code += `        } catch (err: unknown) {\n`;
                code += `            const message = err instanceof Error ? err.message : String(err);\n`;
                code += `            console.error(C.red + 'Error:' + C.reset, message);\n`;
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

        const scanFiles: string[] = [];
        for (const dir of dirsToScan) {
            if (fs.existsSync(dir)) {
                scanFiles.push(...this.walkDir(dir).filter(f => f.endsWith('.contract.ts')));
            }
        }

        for (const file of scanFiles) {
            const content = fs.readFileSync(file, 'utf-8');

            // 1. Hardened defineContract parser
            const contractMatches = content.matchAll(/export\s+const\s+(\w+)\s*=\s*defineContract\s*\(\s*\{([\s\S]*?)\}\s*\)\s*;/g);
            for (const match of contractMatches) {
                const exportName = match[1]!;
                const body = match[2]!;

                const domainMatch = /\bdomain\s*:\s*['"]([^'"]+)['"]/.exec(body);
                const actionMatch = /\baction\s*:\s*['"]([^'"]+)['"]/.exec(body);
                // `(?:[^'\\]|\\.)*` rather than `[^']+`: a quote may be escaped inside the string it
                // delimits, and stopping at the first `'` in `'a site\'s parts'` captures
                // `a site\` — a value ending in a backslash, which then escapes the closing backtick
                // of whatever template literal it is emitted into. See `unescape` below.
                const descMatch = /\bdescription\s*:\s*'((?:[^'\\]|\\.)*)'/.exec(body)
                    || /\bdescription\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(body)
                    || /\bdescription\s*:\s*`((?:[^`\\]|\\.)*)`/.exec(body);
                const restMatch = /\brest\s*:\s*\{([\s\S]*?)\}/.exec(body);

                let method = 'POST';
                let pathStr = '/';
                let isStream = false;

                if (restMatch) {
                    const restBody = restMatch[1]!;
                    const m = /\bmethod\s*:\s*['"]([^'"]+)['"]/.exec(restBody);
                    const p = /\bpath\s*:\s*['"]([^'"]+)['"]/.exec(restBody);
                    const s = /\bisStream\s*:\s*(true|false)/.exec(restBody);
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
                        description: descMatch ? unescapeStringLiteral(descMatch[1] ?? '') : '',
                        method,
                        path: pathStr,
                        isStream
                    });
                }
            }

            // 2. defineCrud Parser
            const crudMatches = content.matchAll(/export\s+const\s+(\w+)\s*=\s*defineCrud\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)/g);
            for (const match of crudMatches) {
                const exportName = match[1]!;
                const domain = match[2]!;

                if (domain.includes('_')) throw new Error(`Domain "${domain}" cannot contain underscores (File: ${file})`);

                const actions = { create: 'create', find: 'find', findOne: 'find_one', count: 'count', get: 'get', resolve: 'resolve', update: 'update', delete: 'delete' };

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

            // 3. defineTimeSeries Parser
            const tsMatches = content.matchAll(/export\s+const\s+(\w+)\s*=\s*defineTimeSeries\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)/g);
            for (const match of tsMatches) {
                const exportName = match[1]!;
                const domain = match[2]!;

                if (domain.includes('_')) throw new Error(`Domain "${domain}" cannot contain underscores (File: ${file})`);

                const actions = { insert: 'insert', query: 'query', aggregate: 'aggregate', latest: 'latest' };

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

            // 4. defineEvent Parser
            const eventMatches = content.matchAll(/export\s+const\s+(\w+)\s*=\s*defineEvent\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)/g);
            for (const match of eventMatches) {
                const exportName = match[1]!;
                const eventName = match[2]!;

                // Add to a generic fallback key to ensure a reliable file-to-alias mapping structure
                if (!domainFiles['__events_fallback__']) domainFiles['__events_fallback__'] = [];
                if (!domainFiles['__events_fallback__'].includes(file)) domainFiles['__events_fallback__'].push(file);

                allEvents.push({
                    exportName,
                    name: eventName,
                    filePath: file
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