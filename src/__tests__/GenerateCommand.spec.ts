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

import { toTemplateLiteral, unescapeStringLiteral } from '../cli/commands/GenerateCommand.js';

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
