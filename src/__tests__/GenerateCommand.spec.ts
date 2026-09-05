/**
 * The generator's string handling.
 *
 * These two functions exist because of a bug whose symptom pointed nowhere near its cause: a contract
 * whose description was `'Resolve a site\'s parts, generate its page, and record what it now serves.'`
 * produced a `ToolCommands.ts` with **eighty syntax errors, every one of them in a different,
 * unrelated command**. The description was read with `[^'"]+`, which cannot skip `\'`, so the capture
 * ended in a backslash; that backslash then escaped the closing backtick of the template literal it
 * was emitted into, and the literal ran on until the next backtick eleven lines later.
 *
 * Both halves are tested, because either alone would have prevented that file — and a description
 * may legitimately contain a backtick or `${` however good the regex gets.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { GenerateCommand, toTemplateLiteral, unescapeStringLiteral } from '../cli/commands/GenerateCommand.js';
import * as siteModule from './fixtures/split-domain/site.contract.js';
import * as releaseModule from './fixtures/split-domain/release.contract.js';

describe('reading a description out of source text', () => {
    /** What the regex captures for `'a site\'s parts'` — the escape is still in it. */
    it('turns an escaped quote back into a quote', () => {
        expect(unescapeStringLiteral("Resolve a site\\'s parts")).toBe("Resolve a site's parts");
    });

    it('leaves a value that never ends in a stray backslash', () => {
        // The actual defect: a trailing backslash escapes whatever delimiter follows it.
        expect(unescapeStringLiteral("a site\\'").endsWith('\\')).toBe(false);
    });

    it('handles the escapes that appear in prose', () => {
        expect(unescapeStringLiteral('a\\nb')).toBe('a\nb');
        expect(unescapeStringLiteral('a\\\\b')).toBe('a\\b');
        expect(unescapeStringLiteral('a \\"quoted\\" thing')).toBe('a "quoted" thing');
    });

    it('leaves ordinary text alone', () => {
        expect(unescapeStringLiteral('Fetch one artifact by its content digest.'))
            .toBe('Fetch one artifact by its content digest.');
    });
});

describe('emitting a description into a template literal', () => {
    const parses = (code: string): boolean => {
        try {
            // The real question is whether the *file* parses, so ask a parser rather than asserting
            // on the escaped string's shape — which would pass while the emitted file did not.
            new Function(`return ${code};`);
            return true;
        } catch {
            return false;
        }
    };

    it('round-trips ordinary prose', () => {
        const value = "Resolve a site's parts, generate its page, and record what it now serves.";
        expect(new Function(`return ${toTemplateLiteral(value)};`)()).toBe(value);
    });

    it('survives a backtick', () => {
        const value = 'Call `identity.whoami` first.';
        expect(parses(toTemplateLiteral(value))).toBe(true);
        expect(new Function(`return ${toTemplateLiteral(value)};`)()).toBe(value);
    });

    it('survives a template placeholder', () => {
        // `${` in prose would otherwise become an interpolation of an identifier that does not exist.
        const value = 'Substitutes ${host} into the path.';
        expect(parses(toTemplateLiteral(value))).toBe(true);
        expect(new Function(`return ${toTemplateLiteral(value)};`)()).toBe(value);
    });

    it('survives a trailing backslash, which is the original defect exactly', () => {
        const value = 'a site\\';
        expect(parses(toTemplateLiteral(value))).toBe(true);
        expect(new Function(`return ${toTemplateLiteral(value)};`)()).toBe(value);
    });

    it('does not let a description close its own literal and open code', () => {
        // The severe form: without escaping, this ends the literal and injects a call into a
        // generated file that runs on a developer's machine.
        const value = '`); process.exit(1); //';
        expect(parses(toTemplateLiteral(value))).toBe(true);
        expect(new Function(`return ${toTemplateLiteral(value)};`)()).toBe(value);
    });
});

describe('generating artifacts for a domain split across multiple files', () => {
    let tmpDir: string;
    const fixturesDir = path.resolve(__dirname, 'fixtures/split-domain');

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-split-domain-test-'));
        const cmd = new GenerateCommand();
        await cmd.execute({ dir: fixturesDir, out: tmpDir });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function parseImportAliases(code: string): Record<string, string> {
        const importRegex = /import\s+\*\s+as\s+(\w+)\s+from\s+'([^']+)';/g;
        const aliases: Record<string, string> = {};
        let match;
        while ((match = importRegex.exec(code)) !== null) {
            aliases[match[1]!] = match[2]!;
        }
        return aliases;
    }

    function getAliases(code: string): { siteAlias: string; releaseAlias: string } {
        const aliases = parseImportAliases(code);
        const siteAlias = Object.keys(aliases).find(a => aliases[a]!.includes('site.contract'))!;
        const releaseAlias = Object.keys(aliases).find(a => aliases[a]!.includes('release.contract'))!;
        expect(siteAlias).toBeDefined();
        expect(releaseAlias).toBeDefined();
        expect(siteAlias).not.toBe(releaseAlias);
        return { siteAlias, releaseAlias };
    }

    it('emits api.ts importing each contract from the module that actually exports it', () => {
        const apiContent = fs.readFileSync(path.join(tmpDir, 'api.ts'), 'utf-8');
        const { siteAlias, releaseAlias } = getAliases(apiContent);

        // siteComposeContract is exported only by site.contract, so it must be referenced via siteAlias
        expect(apiContent).toContain(`typeof ${siteAlias}.siteComposeContract['inputSchema']`);
        expect(apiContent).toContain(`typeof ${siteAlias}.siteComposeContract['outputSchema']`);

        // releaseDeployContract and releaseCrud are exported only by release.contract, so they must be referenced via releaseAlias
        expect(apiContent).toContain(`typeof ${releaseAlias}.releaseDeployContract['inputSchema']`);
        expect(apiContent).toContain(`typeof ${releaseAlias}.releaseDeployContract['outputSchema']`);
        expect(apiContent).toContain(`typeof ${releaseAlias}.releaseCrud['create']['inputSchema']`);
        expect(apiContent).toContain(`typeof ${releaseAlias}.releaseCrud['find']['inputSchema']`);

        // Crucial regression check: neither module alias references symbols it does not export
        expect(apiContent).not.toContain(`${siteAlias}.releaseDeployContract`);
        expect(apiContent).not.toContain(`${siteAlias}.releaseCrud`);
        expect(apiContent).not.toContain(`${releaseAlias}.siteComposeContract`);

        // General invariant: every alias.symbol reference names a symbol its imported module actually exports
        const refRegex = new RegExp(`\\b(${siteAlias}|${releaseAlias})\\.(\\w+)`, 'g');
        let match;
        let refCount = 0;
        while ((match = refRegex.exec(apiContent)) !== null) {
            refCount++;
            const [, alias, symbol] = match;
            if (alias === siteAlias) {
                expect(symbol in siteModule).toBe(true);
                expect(symbol in releaseModule).toBe(false);
            } else {
                expect(symbol in releaseModule).toBe(true);
                expect(symbol in siteModule).toBe(false);
            }
        }
        expect(refCount).toBeGreaterThan(0);
    });

    it('emits cli/ToolCommands.ts importing each command from the module that actually exports it', () => {
        const cliContent = fs.readFileSync(path.join(tmpDir, 'cli/ToolCommands.ts'), 'utf-8');
        const { siteAlias, releaseAlias } = getAliases(cliContent);

        // Subcommands in domain 'cdn' must reference their respective declaring module
        expect(cliContent).toContain(`executeCommand('cdn.compose', o, ${siteAlias}.siteComposeContract, cmd.optsWithGlobals())`);
        expect(cliContent).toContain(`ZodToCliMapper.applyOptions(cmd_cdn_siteComposeContract_compose, ${siteAlias}.siteComposeContract.inputSchema)`);

        expect(cliContent).toContain(`executeCommand('cdn.deploy', o, ${releaseAlias}.releaseDeployContract, cmd.optsWithGlobals())`);
        expect(cliContent).toContain(`ZodToCliMapper.applyOptions(cmd_cdn_releaseDeployContract_deploy, ${releaseAlias}.releaseDeployContract.inputSchema)`);

        expect(cliContent).toContain(`executeCommand('cdn.create', o, ${releaseAlias}.releaseCrud['create'], cmd.optsWithGlobals())`);
        expect(cliContent).toContain(`ZodToCliMapper.applyOptions(cmd_cdn_releaseCrud_create_create, ${releaseAlias}.releaseCrud['create'].inputSchema)`);

        // Regression check: no cross-module references to missing symbols
        expect(cliContent).not.toContain(`${siteAlias}.releaseDeployContract`);
        expect(cliContent).not.toContain(`${siteAlias}.releaseCrud`);
        expect(cliContent).not.toContain(`${releaseAlias}.siteComposeContract`);

        // General invariant: every alias.symbol reference names a symbol its imported module actually exports
        const refRegex = new RegExp(`\\b(${siteAlias}|${releaseAlias})\\.(\\w+)`, 'g');
        let match;
        let refCount = 0;
        while ((match = refRegex.exec(cliContent)) !== null) {
            refCount++;
            const [, alias, symbol] = match;
            if (alias === siteAlias) {
                expect(symbol in siteModule).toBe(true);
                expect(symbol in releaseModule).toBe(false);
            } else {
                expect(symbol in releaseModule).toBe(true);
                expect(symbol in siteModule).toBe(false);
            }
        }
        expect(refCount).toBeGreaterThan(0);
    });

    it('emits events.ts importing events and CRUD notifications from the defining file', () => {
        const eventsContent = fs.readFileSync(path.join(tmpDir, 'events.ts'), 'utf-8');
        const { siteAlias, releaseAlias } = getAliases(eventsContent);

        // Specific events point to their respective file
        expect(eventsContent).toContain(`'cdn.site_updated': z.infer<typeof ${siteAlias}.siteEvent['schema']>;`);
        expect(eventsContent).toContain(`'cdn.released': z.infer<typeof ${releaseAlias}.releaseEvent['schema']>;`);

        // Named CRUD event types reference releaseCrud from the file that defined it
        expect(eventsContent).toContain(`'cdn.created': z.infer<typeof ${releaseAlias}.releaseCrud['create']['outputSchema']>;`);
        expect(eventsContent).toContain(`'cdn.updated': { id: string; patch: Record<string, unknown>; item: z.infer<typeof ${releaseAlias}.releaseCrud['update']['outputSchema']> };`);

        // Regression check: siteAlias does not define releaseCrud or releaseEvent
        expect(eventsContent).not.toContain(`${siteAlias}.releaseCrud`);
        expect(eventsContent).not.toContain(`${siteAlias}.releaseEvent`);
        expect(eventsContent).not.toContain(`${releaseAlias}.siteEvent`);

        // General invariant
        const refRegex = new RegExp(`\\b(${siteAlias}|${releaseAlias})\\.(\\w+)`, 'g');
        let match;
        let refCount = 0;
        while ((match = refRegex.exec(eventsContent)) !== null) {
            refCount++;
            const [, alias, symbol] = match;
            if (alias === siteAlias) {
                expect(symbol in siteModule).toBe(true);
                expect(symbol in releaseModule).toBe(false);
            } else {
                expect(symbol in releaseModule).toBe(true);
                expect(symbol in siteModule).toBe(false);
            }
        }
        expect(refCount).toBeGreaterThan(0);
    });
});
