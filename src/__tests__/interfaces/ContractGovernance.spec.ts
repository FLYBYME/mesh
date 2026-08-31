import { z } from 'zod';
import {
    ContractRegistry,
    DEFAULT_VISIBILITY,
    assertValidDependencies,
    defineContract,
    isPublicContract,
    visibilityOf,
    type ToolContract,
} from '../../interfaces/IToolContract.js';
import { defineCrud } from '../../interfaces/ICrudContract.js';

/**
 * Covers the two governance fields added in 2.0.0: required `dependencies` on `defineCrud`, and
 * `visibility` defaulting to `internal` everywhere.
 *
 * These are the rules a whole codebase is now held to, so they are tested at the boundary that
 * enforces them rather than through a service.
 */
describe('contract governance', () => {
    const TestSchema = z.object({ name: z.string() });

    const ALL_ACTIONS = [
        'find', 'findOne', 'count', 'get', 'resolve',
        'create', 'createMany', 'update', 'replace', 'delete',
    ] as const;

    describe('defineCrud dependencies', () => {
        it('accepts an empty array as a real answer', () => {
            const crud = defineCrud('depsempty', TestSchema, { dependencies: [] });
            expect(crud.dependencies).toEqual([]);
        });

        it('records declared dependencies on the set and on every generated contract', () => {
            const crud = defineCrud('depsrecorded', TestSchema, {
                dependencies: ['dnsZone.get', 'node'],
            });

            expect(crud.dependencies).toEqual(['dnsZone.get', 'node']);
            for (const action of ALL_ACTIONS) {
                expect(crud[action].dependencies).toEqual(['dnsZone.get', 'node']);
            }
        });

        it('freezes the recorded list so a caller cannot mutate it after definition', () => {
            const declared = ['node.resolve'];
            const crud = defineCrud('depsfrozen', TestSchema, { dependencies: declared });

            declared.push('sneaky.write');

            expect(crud.dependencies).toEqual(['node.resolve']);
            expect(() => (crud.dependencies as string[]).push('also.sneaky')).toThrow();
        });

        it('rejects a malformed contract key', () => {
            expect(() => defineCrud('depsbad', TestSchema, { dependencies: ['not a key'] }))
                .toThrow(/is not a valid contract key/);
        });

        it('rejects a duplicated dependency', () => {
            expect(() => defineCrud('depsdupe', TestSchema, { dependencies: ['node.get', 'node.get'] }))
                .toThrow(/listed more than once/);
        });

        it('rejects a non-array, which is what a JS caller ignoring the types will pass', () => {
            expect(() => defineCrud('depsnotarray', TestSchema, {
                dependencies: 'node.get' as unknown as string[],
            })).toThrow(/must be an array/);
        });

        it('allows underscores in the action half but not the domain half', () => {
            expect(() => assertValidDependencies(['node.find_one'], 'test')).not.toThrow();
            expect(() => assertValidDependencies(['bad_domain.find'], 'test')).toThrow();
        });
    });

    describe('visibility', () => {
        it('defaults to internal, and the default is internal', () => {
            expect(DEFAULT_VISIBILITY).toBe('internal');

            const crud = defineCrud('vizdefault', TestSchema, { dependencies: [] });
            for (const action of ALL_ACTIONS) {
                expect(visibilityOf(crud[action])).toBe('internal');
                expect(isPublicContract(crud[action])).toBe(false);
            }
        });

        it('publishes only the actions named, leaving the rest internal', () => {
            const crud = defineCrud('vizpartial', TestSchema, {
                dependencies: [],
                visibility: { find: 'public', get: 'public' },
            });

            expect(isPublicContract(crud.find)).toBe(true);
            expect(isPublicContract(crud.get)).toBe(true);
            for (const action of ALL_ACTIONS) {
                if (action === 'find' || action === 'get') continue;
                expect(isPublicContract(crud[action])).toBe(false);
            }
        });

        it('treats an explicit contract with no declared visibility as internal', () => {
            const contract = defineContract({
                domain: 'vizexplicit', action: 'silent',
                description: 'no visibility declared',
                inputSchema: z.object({}), outputSchema: z.object({}),
                rest: { method: 'GET', path: '/vizexplicit/silent' },
                print: () => '',
            });

            expect(visibilityOf(contract)).toBe('internal');
        });

        it('honours an explicit public declaration', () => {
            const contract = defineContract({
                domain: 'vizexplicit', action: 'loud',
                description: 'published',
                inputSchema: z.object({}), outputSchema: z.object({}),
                rest: { method: 'GET', path: '/vizexplicit/loud' },
                visibility: 'public',
                print: () => '',
            });

            expect(isPublicContract(contract)).toBe(true);
        });

        it('validates dependencies declared on an explicit contract too', () => {
            expect(() => defineContract({
                domain: 'vizexplicit', action: 'baddeps',
                description: 'bad deps',
                inputSchema: z.object({}), outputSchema: z.object({}),
                rest: { method: 'GET', path: '/vizexplicit/baddeps' },
                dependencies: ['no spaces allowed'],
                print: () => '',
            })).toThrow(/is not a valid contract key/);
        });
    });

    describe('ContractRegistry queries', () => {
        const stub = (
            domain: string,
            action: string,
            extra: Partial<ToolContract> = {},
        ): ToolContract => ({
            domain, action,
            description: `${domain}.${action}`,
            inputSchema: z.object({}),
            outputSchema: z.object({}),
            rest: { method: 'GET', path: `/${domain}/${action}` },
            print: () => '',
            ...extra,
        }) as ToolContract;

        let registry: ContractRegistry;

        beforeEach(() => {
            // A local registry, not the global one -- these assertions are about exact counts, and
            // the global registry accumulates every contract any other spec file imported.
            registry = new ContractRegistry();
        });

        it('separates the published surface from the internal one', () => {
            registry.register(stub('alpha', 'read', { visibility: 'public' }));
            registry.register(stub('alpha', 'write'));
            registry.register(stub('beta', 'find'));

            expect(registry.size).toBe(3);
            expect(registry.publicContracts().map(c => c.action)).toEqual(['read']);
            expect(registry.internalContracts().map(c => c.action).sort()).toEqual(['find', 'write']);
        });

        it('lists a domain’s contracts regardless of visibility', () => {
            registry.register(stub('alpha', 'read', { visibility: 'public' }));
            registry.register(stub('alpha', 'write'));
            registry.register(stub('beta', 'find'));

            expect(registry.byDomain('alpha').map(c => c.action).sort()).toEqual(['read', 'write']);
            expect(registry.byDomain('nothere')).toEqual([]);
        });

        it('resolves a dependency naming an exact contract key', () => {
            registry.register(stub('alpha', 'read', { dependencies: ['beta.find'] }));
            registry.register(stub('beta', 'find'));

            expect(registry.findUnresolvedDependencies()).toEqual([]);
        });

        it('resolves a bare-domain dependency against any contract in that domain', () => {
            registry.register(stub('alpha', 'read', { dependencies: ['beta'] }));
            registry.register(stub('beta', 'find'));

            expect(registry.findUnresolvedDependencies()).toEqual([]);
        });

        it('reports a dependency whose target was never registered', () => {
            registry.register(stub('alpha', 'read', { dependencies: ['beta.find', 'gamma'] }));

            expect(registry.findUnresolvedDependencies()).toEqual([
                { contract: 'alpha.read', dependency: 'beta.find' },
                { contract: 'alpha.read', dependency: 'gamma' },
            ]);
        });

        it('reports a dependency on the right action of a domain that exists', () => {
            registry.register(stub('alpha', 'read', { dependencies: ['beta.missing'] }));
            registry.register(stub('beta', 'find'));

            expect(registry.findUnresolvedDependencies()).toEqual([
                { contract: 'alpha.read', dependency: 'beta.missing' },
            ]);
        });
    });
});
