import { z } from 'zod';
import { Command } from 'commander';
import { ZodToCliMapper } from './ZodToCliMapper.js';

describe('ZodToCliMapper', () => {
    describe('applyOptions()', () => {
        it('should map ZodString to --key <string>', () => {
            const schema = z.object({ name: z.string().describe('The name') });
            const cmd = new Command();
            ZodToCliMapper.applyOptions(cmd, schema);
            
            const opt = cmd.options.find(o => o.long === '--name');
            expect(opt).toBeDefined();
            expect(opt?.description).toBe('The name');
            expect(opt?.flags).toContain('<string>');
        });

        it('should map ZodNumber to --key <number>', () => {
            const schema = z.object({ age: z.number().describe('The age') });
            const cmd = new Command();
            ZodToCliMapper.applyOptions(cmd, schema);
            
            const opt = cmd.options.find(o => o.long === '--age');
            expect(opt?.flags).toContain('<number>');
        });

        it('should map ZodBoolean to --key and --no-key', () => {
            const schema = z.object({ force: z.boolean().describe('Force action') });
            const cmd = new Command();
            ZodToCliMapper.applyOptions(cmd, schema);
            
            expect(cmd.options.find(o => o.long === '--force')).toBeDefined();
            expect(cmd.options.find(o => o.long === '--no-force')).toBeDefined();
        });

        it('should map ZodEnum to constrained values', () => {
            const schema = z.object({ mode: z.enum(['read', 'write']) });
            const cmd = new Command();
            ZodToCliMapper.applyOptions(cmd, schema);
            
            const opt = cmd.options.find(o => o.long === '--mode');
            expect(opt?.flags).toContain('<read|write>');
        });

        it('should map ZodArray to variadic <values...>', () => {
            const schema = z.object({ files: z.array(z.string()) });
            const cmd = new Command();
            ZodToCliMapper.applyOptions(cmd, schema);
            
            const opt = cmd.options.find(o => o.long === '--files');
            expect(opt?.flags).toContain('<values...>');
        });

        it('should map nested ZodObjects to dot-notation', () => {
            const schema = z.object({ config: z.object({ port: z.number() }) });
            const cmd = new Command();
            ZodToCliMapper.applyOptions(cmd, schema);
            
            const opt = cmd.options.find(o => o.long === '--config.port');
            expect(opt).toBeDefined();
        });

        it('should unwrap optional and default schemas', () => {
            const schema = z.object({ 
                test: z.string().optional().default('foo').describe('Test desc') 
            });
            const cmd = new Command();
            ZodToCliMapper.applyOptions(cmd, schema);
            
            const opt = cmd.options.find(o => o.long === '--test');
            expect(opt).toBeDefined();
            expect(opt?.description).toBe('Test desc');
        });
    });

    describe('parseOptions()', () => {
        it('should unflatten dot-notation options', () => {
            const schema = z.object({ config: z.object({ port: z.number() }) });
            const raw = { 'config.port': 8080 };
            
            const parsed = ZodToCliMapper.parseOptions(raw, schema);
            expect(parsed).toEqual({ config: { port: 8080 } });
        });

        it('should coerce number strings to numbers', () => {
            const schema = z.object({ age: z.number() });
            const parsed = ZodToCliMapper.parseOptions({ age: '42' }, schema);
            expect(parsed.age).toBe(42);
        });

        it('should coerce boolean strings to booleans', () => {
            const schema = z.object({ active: z.boolean(), inactive: z.boolean() });
            const parsed = ZodToCliMapper.parseOptions({ active: 'true', inactive: 'false' }, schema);
            expect(parsed.active).toBe(true);
            expect(parsed.inactive).toBe(false);
        });

        it('should parse JSON strings for objects and arrays', () => {
            const schema = z.object({ data: z.record(z.string(), z.any()), items: z.array(z.string()) });
            const parsed = ZodToCliMapper.parseOptions({ 
                data: '{"foo":"bar"}',
                items: '["a","b"]'
            }, schema);
            expect(parsed.data).toEqual({ foo: 'bar' });
            expect(parsed.items).toEqual(['a', 'b']);
        });

        it('should leave unknown properties untouched', () => {
            const schema = z.object({ known: z.string() });
            const parsed = ZodToCliMapper.parseOptions({ known: 'a', unknown: 'b' }, schema);
            expect((parsed as any).unknown).toBe('b');
        });
    });
});
