import { z } from 'zod';
import { toolKey, parseToolKey, defineContract, defaultPrint, globalContractRegistry } from '../interfaces/IToolContract.js';

describe('IToolContract', () => {
    describe('toolKey()', () => {
        it('should combine domain and action with a dot', () => {
            const contract = { domain: 'math', action: 'add' } as any;
            expect(toolKey(contract)).toBe('math.add');
        });
    });

    describe('parseToolKey()', () => {
        it('should split key into domain and action', () => {
            const { domain, action } = parseToolKey('math.add');
            expect(domain).toBe('math');
            expect(action).toBe('add');
        });

        it('should handle key with no dot', () => {
            const { domain, action } = parseToolKey('globalAction');
            expect(domain).toBe('globalAction');
            expect(action).toBe('');
        });
    });

    describe('defineContract()', () => {
        beforeEach(() => {
            globalContractRegistry.clear();
        });

        it('should create a contract and register it globally', () => {
            const spec = {
                domain: 'test',
                action: 'doit',
                description: 'test desc',
                inputSchema: z.object({}),
                outputSchema: z.object({}),
                rest: { method: 'GET' as const, path: '/' },
                destructive: false,
                print: defaultPrint
            };

            const contract = defineContract(spec);

            expect(contract.domain).toBe('test');
            expect(contract.action).toBe('doit');
            expect(globalContractRegistry.has('test.doit')).toBe(true);
        });

        it('should throw an error if domain contains underscores', () => {
            const spec = {
                domain: 'invalid_domain',
                action: 'doit',
                description: 'test desc',
                inputSchema: z.object({}),
                outputSchema: z.object({}),
                rest: { method: 'GET' as const, path: '/' },
                destructive: false,
                print: defaultPrint
            };

            expect(() => defineContract(spec as any)).toThrow("defineContract: domain \"invalid_domain\" must not contain underscores. Use squashed lowercase (e.g. 'toolcalls') for key separation.");
        });

        it('should allow setting a custom timeout in defineContract', () => {
            const spec = {
                domain: 'test',
                action: 'doit',
                description: 'test desc',
                inputSchema: z.object({}),
                outputSchema: z.object({}),
                rest: { method: 'GET' as const, path: '/' },
                destructive: false,
                timeout: 5000,
                print: defaultPrint
            };

            const contract = defineContract(spec);
            expect(contract.timeout).toBe(5000);
        });
    });

    describe('defaultPrint()', () => {
        it('should return indented JSON for objects', () => {
            const obj = { a: 1 };
            expect(defaultPrint(obj)).toBe('{\n  "a": 1\n}');
        });

        it('should return string representation for strings', () => {
            expect(defaultPrint('hello')).toBe('hello');
        });

        it('should return string representation for numbers', () => {
            expect(defaultPrint(42)).toBe('42');
        });
    });
});
