import fs from 'fs';
import path from 'path';

export interface ContractDiscovery {
    exportName: string;
    domain: string;
    action: string;
    description: string;
    method: string;
    path: string;
    isStream: boolean;
}

/**
 * Codegen: Consolidates the artifact generation logic (SDK, API interface) based on contracts.
 */
export class Codegen {
    private readonly artifactRoot: string;

    constructor(private readonly outDir: string = './src/generated') {
        this.artifactRoot = path.resolve(this.outDir);
    }

    public async execute(dirsToScan: string[]): Promise<void> {
        console.log('--- Generating Mesh Artifacts ---');
        
        if (!fs.existsSync(this.artifactRoot)) {
            fs.mkdirSync(this.artifactRoot, { recursive: true });
        }

        const { discovery, files } = this.discoverAllContracts(dirsToScan);

        await this.generateApiInterface(discovery, files);
        await this.generateContextApi(discovery, files);
        await this.generateSDK(discovery, files);

        console.log('\n--- Generation Complete ---');
    }

    private async generateApiInterface(discovery: ContractDiscovery[], files: Record<string, string[]>): Promise<void> {
        console.log('Generating IMeshApi interface...');
        const filePath = path.join(this.artifactRoot, 'api.ts');
        const aliasMap = this.getAliasMap(files, this.artifactRoot);

        let code = `import { z } from 'zod';\n`;
        code += `import { IMeshApi } from '../services/api';\n`;
        Object.values(aliasMap).forEach(m => {
            code += `import * as ${m.alias} from '${m.path}';\n`;
        });

        code += `\ndeclare module '../services/api' {\n`;
        code += `    interface IMeshApi {\n`;

        const byDomain: Record<string, ContractDiscovery[]> = {};
        discovery.forEach(d => {
            if (!byDomain[d.domain]) byDomain[d.domain] = [];
            byDomain[d.domain].push(d);
        });

        for (const [domain, methods] of Object.entries(byDomain)) {
            code += `        readonly ${domain}: {\n`;
            const domainFiles = files[domain];
            if (!domainFiles || domainFiles.length === 0) continue;
            const alias = aliasMap[domainFiles[0]!]?.alias;
            if (!alias) continue;

            for (const m of methods) {
                let inputType = 'unknown', outputType = 'unknown';

                if (m.exportName.includes('.')) {
                    const [c, k] = m.exportName.split('.');
                    inputType = `z.input<typeof ${alias}.${c}['${k}']['inputSchema']>`;
                    outputType = `z.infer<typeof ${alias}.${c}['${k}']['outputSchema']>`;
                } else {
                    inputType = `z.input<typeof ${alias}.${m.exportName}['inputSchema']>`;
                    outputType = `z.infer<typeof ${alias}.${m.exportName}['outputSchema']>`;
                }

                const retType = m.isStream ? `AsyncIterable<${outputType}>` : `Promise<${outputType}>`;
                code += `            /** ${m.description} */\n`;
                code += `            readonly ${m.action}: (args: ${inputType}) => ${retType};\n`;
            }
            code += `        };\n`;
        }

        code += `    }\n}\n`;
        code += `\nexport { IMeshApi };\n`;
        fs.writeFileSync(filePath, code);
    }

    private async generateContextApi(discovery: ContractDiscovery[], files: Record<string, string[]>): Promise<void> {
        console.log('Generating ContextApi implementation...');
        const outDir = path.join(this.artifactRoot, 'server');
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        const filePath = path.join(outDir, 'ContextApi.ts');

        const aliasMap = this.getAliasMap(files, outDir);

        let code = `import { z } from 'zod';\n`;
        code += `import { IMeshApi } from '../api';\n`;
        code += `import { IServiceContext } from '../../services/ServiceModule';\n`;
        code += `import { ServiceExecutor } from '../../services/ServiceExecutor';\n`;
        Object.values(aliasMap).forEach(m => {
            code += `import * as ${m.alias} from '${m.path}';\n`;
        });

        code += `\nexport class ContextApi implements IMeshApi {\n`;
        code += `    constructor(private executor: ServiceExecutor<ContextApi>, private context: IServiceContext<ContextApi>) {}\n\n`;

        const byDomain: Record<string, ContractDiscovery[]> = {};
        discovery.forEach(d => {
            if (!byDomain[d.domain]) byDomain[d.domain] = [];
            byDomain[d.domain].push(d);
        });

        for (const [domain, methods] of Object.entries(byDomain)) {
            code += `    public readonly ${domain} = {\n`;
            const domainFiles = files[domain];
            if (!domainFiles || domainFiles.length === 0) continue;
            const alias = aliasMap[domainFiles[0]!]?.alias;
            if (!alias) continue;

            for (const m of methods) {
                let inputType = 'unknown', outputType = 'unknown';

                if (m.exportName.includes('.')) {
                    const [c, k] = m.exportName.split('.');
                    inputType = `z.input<typeof ${alias}.${c}['${k}']['inputSchema']>`;
                    outputType = `z.infer<typeof ${alias}.${c}['${k}']['outputSchema']>`;
                } else {
                    inputType = `z.input<typeof ${alias}.${m.exportName}['inputSchema']>`;
                    outputType = `z.infer<typeof ${alias}.${m.exportName}['outputSchema']>`;
                }

                const execMethod = m.isStream ? 'executeStream' : 'execute';
                code += `        ${m.action}: (args: ${inputType}): ${m.isStream ? 'AsyncIterable' : 'Promise'}<${outputType}> => \n`;
                code += `            this.executor.${execMethod}<${outputType}>('${domain}', '${m.action}', args, this.context as any),\n`;
            }
            code += `    };\n`;
        }

        code += `}\n`;
        fs.writeFileSync(filePath, code);
    }

    private async generateSDK(discovery: ContractDiscovery[], files: Record<string, string[]>): Promise<void> {
        console.log('Generating SDK Client...');
        const outDir = path.join(this.artifactRoot, 'client');
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        const filePath = path.join(outDir, 'MeshClient.ts');

        const aliasMap = this.getAliasMap(files, outDir);

        let code = `import { z } from 'zod';\n`;
        code += `import type { IMeshApp } from '../../interfaces';\n`;
        Object.values(aliasMap).forEach(m => {
            code += `import * as ${m.alias} from '${m.path}';\n`;
        });

        code += `\nexport class MeshClient {\n`;
        code += `    constructor(private readonly app: IMeshApp) {}\n\n`;

        const byDomain: Record<string, ContractDiscovery[]> = {};
        discovery.forEach(d => {
            if (!byDomain[d.domain]) byDomain[d.domain] = [];
            byDomain[d.domain].push(d);
        });

        code += `    public readonly contracts = {\n`;
        for (const [domain, methods] of Object.entries(byDomain)) {
            code += `        ${domain}: {\n`;
            for (const m of methods) {
                const alias = aliasMap[files[domain]![0]]!.alias;
                let contractRef = '';

                if (m.exportName.includes('.')) {
                    const [c, k] = m.exportName.split('.');
                    contractRef = `${alias}.${c}['${k}']`;
                } else {
                    contractRef = `${alias}.${m.exportName}`;
                }

                code += `            ${m.action}: ${contractRef},\n`;
            }
            code += `        },\n`;
        }
        code += `    };\n\n`;

        code += `    public readonly api = {\n`;
        for (const [domain, methods] of Object.entries(byDomain)) {
            code += `        ${domain}: {\n`;
            for (const m of methods) {
                const alias = aliasMap[files[domain]![0]]!.alias;
                let inputType = 'unknown', outputType = 'unknown', outputSchema = 'unknown';

                if (m.exportName.includes('.')) {
                    const [c, k] = m.exportName.split('.');
                    inputType = `z.input<typeof ${alias}.${c}['${k}']['inputSchema']>`;
                    outputType = `z.infer<typeof ${alias}.${c}['${k}']['outputSchema']>`;
                    outputSchema = `${alias}.${c}['${k}'].outputSchema`;
                } else {
                    inputType = `z.input<typeof ${alias}.${m.exportName}['inputSchema']>`;
                    outputType = `z.infer<typeof ${alias}.${m.exportName}['outputSchema']>`;
                    outputSchema = `${alias}.${m.exportName}.outputSchema`;
                }

                const toolKey = `${domain}:${m.action}`;

                if (m.isStream) {
                    code += `            ${m.action}: async function* (args: ${inputType}, opts?: any): AsyncIterable<${outputType}> {\n`;
                    code += `                throw new Error("Streaming not yet implemented in MeshApp client");\n`;
                    code += `            },\n`;
                } else {
                    code += `            ${m.action}: async (args: ${inputType}, opts?: any): Promise<${outputType}> => {\n`;
                    code += `                const result = await this.app.call('${toolKey}', args, opts);\n`;
                    code += `                return ${outputSchema}.parse(result);\n`;
                    code += `            },\n`;
                }
            }
            code += `        },\n`;
        }
        code += `    };\n}\n`;
        fs.writeFileSync(filePath, code);
        console.log('✔ SDK Client generated.');
    }

    private discoverAllContracts(dirsToScan: string[]): { discovery: ContractDiscovery[], files: Record<string, string[]> } {
        const allContracts: ContractDiscovery[] = [];
        const domainFiles: Record<string, string[]> = {};

        const files: string[] = [];
        for (const dir of dirsToScan) {
            if (fs.existsSync(dir)) {
                files.push(...this.walkDir(dir).filter(f => f.endsWith('.contract.ts') || f.endsWith('.ts')));
            }
        }

        for (const file of files) {
            const content = fs.readFileSync(file, 'utf-8');

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
                    if (!domainFiles[domain]) domainFiles[domain] = [];
                    if (!domainFiles[domain].includes(file)) domainFiles[domain].push(file);

                    allContracts.push({
                        exportName,
                        domain,
                        action: actionMatch[1]!,
                        description: descMatch ? (descMatch[1] || descMatch[2] || '') : '',
                        method,
                        path: pathStr,
                        isStream
                    });
                }
            }

            const crudMatches = content.matchAll(/export\s+const\s+(\w+)\s*=\s*defineCrud\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)/g);
            for (const match of crudMatches) {
                const exportName = match[1]!;
                const domain = match[2]!;

                const actions = {
                    create: 'create',
                    find: 'find',
                    findOne: 'find_one',
                    count: 'count',
                    get: 'get',
                    update: 'update',
                    delete: 'delete'
                };

                const crudStart = content.indexOf(`export const ${exportName}`);
                const crudEnd = content.indexOf(');', crudStart);
                const fullCrudCall = content.substring(crudStart, crudEnd);

                const optionsMatch = /defineCrud\s*\(\s*['"][^'"]+['"]\s*,\s*[^,]+\s*,\s*(\{[\s\S]*\})\s*$/.exec(fullCrudCall);
                const optionsBody = optionsMatch ? optionsMatch[1]! : '';

                let plural = `${domain}s`;
                let idField = 'id';

                if (optionsBody) {
                    const pluralMatch = /\bpluralPath:\s*['"]([^'"]+)['"]/.exec(optionsBody);
                    const idMatch = /\bidField:\s*['"]([^'"]+)['"]/.exec(optionsBody);
                    if (pluralMatch) plural = pluralMatch[1]!;
                    if (idMatch) idField = idMatch[1]!;

                    const actionsMatch = /\bactions:\s*\{([\s\S]*?)\}/.exec(optionsBody);
                    if (actionsMatch) {
                        const ab = actionsMatch[1]!;
                        ['create', 'list', 'count', 'get', 'update', 'delete'].forEach(a => {
                            const m = new RegExp(`\\b${a}:\\s*['"]([^'"]+)['"]`).exec(ab);
                            if (m) (actions as Record<string, string>)[a] = m[1]!;
                        });
                    }
                }

                if (!domainFiles[domain]) domainFiles[domain] = [];
                if (!domainFiles[domain].includes(file)) domainFiles[domain].push(file);

                Object.entries(actions).forEach(([key, action]) => {
                    const m: Record<string, { method: string, path: string }> = {
                        create: { method: 'POST', path: `/${plural}` },
                        find: { method: 'GET', path: `/${plural}/all` },
                        findOne: { method: 'GET', path: `/${plural}/one` },
                        count: { method: 'GET', path: `/${plural}/count` },
                        get: { method: 'GET', path: `/${plural}/:${idField}` },
                        update: { method: 'PATCH', path: `/${plural}/:${idField}` },
                        delete: { method: 'DELETE', path: `/${plural}/:${idField}` }
                    };
                    const meta = m[key];
                    if (!meta) return;

                    allContracts.push({
                        exportName: `${exportName}.${key}`,
                        domain,
                        action,
                        description: `CRUD ${key} for ${domain} (${exportName})`,
                        method: meta.method,
                        path: meta.path,
                        isStream: false
                    });
                });
            }
        }
        return { discovery: allContracts, files: domainFiles };
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

    private getAliasMap(files: Record<string, string[]>, baseDir: string): Record<string, { alias: string, path: string }> {
        const allFiles = Array.from(new Set(Object.values(files).flat()));
        const map: Record<string, { alias: string, path: string }> = {};

        allFiles.forEach((file, idx) => {
            let importPath = path.relative(baseDir, file).replace(/\\/g, '/').replace(/\.ts$/, '');
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
