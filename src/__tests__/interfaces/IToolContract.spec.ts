import { z } from 'zod';
import {
    defineContract,
    toolKey,
    parseToolKey,
    defaultPrint,
    ContractRegistry,
    globalContractRegistry
} from '../../interfaces/IToolContract.js';

describe('IToolContract', () => {
    // ─── defineContract ─────────────────────────────────────────────────────

    describe('defineContract()', () => {
        it('should create a valid contract with all fields', () => {
            const contract = defineContract({
                domain: 'test',
                action: 'greet',
                description: 'A greeting tool',
                inputSchema: z.object({ name: z.string() }),
                outputSchema: z.object({ message: z.string() }),
                rest: { method: 'POST', path: '/test/greet' },
                destructive: false,
                print: defaultPrint
            });

            expect(contract.domain).toBe('test');
            expect(contract.action).toBe('greet');
            expect(contract.rest.method).toBe('POST');
        });

        it('should throw when domain contains underscores', () => {
            expect(() => defineContract({
                domain: 'bad_domain',
                action: 'test',
                description: 'Should fail',
                inputSchema: z.object({}),
                outputSchema: z.object({}),
                rest: { method: 'GET', path: '/test' },
                print: defaultPrint
            })).toThrow('must not contain underscores');
        });

        it('should allow underscores in action names', () => {
            expect(() => defineContract({
                domain: 'valid',
                action: 'find_one',
                description: 'Should succeed',
                inputSchema: z.object({}),
                outputSchema: z.object({}),
                rest: { method: 'GET', path: '/test' },
                print: defaultPrint
            })).not.toThrow();
        });

        it('should auto-register in the global contract registry', () => {
            const contract = defineContract({
                domain: 'autoreg',
                action: 'check',
                description: 'Auto-registered',
                inputSchema: z.object({}),
                outputSchema: z.object({ ok: z.boolean() }),
                rest: { method: 'GET', path: '/autoreg/check' },
                print: defaultPrint
            });

            const key = toolKey(contract);
            expect(globalContractRegistry.has(key)).toBe(true);
        });
    });

    // ─── toolKey ────────────────────────────────────────────────────────────

    describe('toolKey()', () => {
        it('should generate domain.action key', () => {
            const contract = defineContract({
                domain: 'math',
                action: 'add',
                description: 'Add numbers',
                inputSchema: z.object({}),
                outputSchema: z.number(),
                rest: { method: 'POST', path: '/math/add' },
                print: defaultPrint
            });
            expect(toolKey(contract)).toBe('math.add');
        });
    });

    // ─── parseToolKey ───────────────────────────────────────────────────────

    describe('parseToolKey()', () => {
        it('should parse domain and action from a dotted key', () => {
            const result = parseToolKey('agent.run');
            expect(result.domain).toBe('agent');
            expect(result.action).toBe('run');
        });

        it('should handle keys with underscored actions', () => {
            const result = parseToolKey('email.find_one');
            expect(result.domain).toBe('email');
            expect(result.action).toBe('find_one');
        });

        it('should handle keys without dots', () => {
            const result = parseToolKey('singleton');
            expect(result.domain).toBe('singleton');
            expect(result.action).toBe('');
        });
    });

    // ─── defaultPrint ───────────────────────────────────────────────────────

    describe('defaultPrint()', () => {
        it('should return string as-is', () => {
            expect(defaultPrint('hello')).toBe('hello');
        });

        it('should JSON stringify objects', () => {
            const result = defaultPrint({ a: 1, b: 'two' });
            const parsed = JSON.parse(result);
            expect(parsed.a).toBe(1);
            expect(parsed.b).toBe('two');
        });
    });

    // ─── ContractRegistry ───────────────────────────────────────────────────

    describe('ContractRegistry', () => {
        let registry: ContractRegistry;

        beforeEach(() => {
            registry = new ContractRegistry();
        });

        it('should register and retrieve contracts', () => {
            const contract = defineContract({
                domain: 'reg',
                action: 'test',
                description: 'Registry test',
                inputSchema: z.object({}),
                outputSchema: z.object({}),
                rest: { method: 'GET', path: '/reg/test' },
                print: defaultPrint
            });

            registry.register(contract);
            expect(registry.has('reg.test')).toBe(true);
            expect(registry.get('reg.test')).toBeDefined();
        });

        it('should not duplicate contracts with same key', () => {
            const contract = defineContract({
                domain: 'dedup',
                action: 'test',
                description: 'Dedup test',
                inputSchema: z.object({}),
                outputSchema: z.object({}),
                rest: { method: 'GET', path: '/dedup/test' },
                print: defaultPrint
            });

            registry.register(contract);
            registry.register(contract);
            expect(registry.size).toBe(1);
        });

        it('should clear all contracts', () => {
            const contract = defineContract({
                domain: 'clearable',
                action: 'test',
                description: 'Clear test',
                inputSchema: z.object({}),
                outputSchema: z.object({}),
                rest: { method: 'GET', path: '/clearable/test' },
                print: defaultPrint
            });

            registry.register(contract);
            expect(registry.size).toBe(1);
            registry.clear();
            expect(registry.size).toBe(0);
        });
    });
});
