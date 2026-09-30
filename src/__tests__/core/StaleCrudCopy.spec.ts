import { z } from 'zod';
import { declarationOf, toolInfoOf } from '../../core/ContractDeclaration.js';
import { defineCrud, globalCrudRegistry } from '../../interfaces/ICrudContract.js';
import { globalContractRegistry } from '../../interfaces/IToolContract.js';

/**
 * Two copies of one collection in one process -- the owner's, and a stale one bundled by a part
 * that only calls it. The two registries disagree on who wins: the contract registry keeps the
 * *first* copy, the CRUD registry (which the executor strips `hidden` by) the *last*.
 *
 * On edge1 (2026-09-30) mail-service's copy of dnsZone, from before
 * `hidden: ['dnssecPrivateKey']`, loaded first: the api described the private key as a zone
 * output, while the data stayed stripped. The other order is the dangerous one -- the description
 * looks right and the executor, reading the stale copy, returns the key.
 */
const ZoneSchema = z.object({ name: z.string(), secretKey: z.string().optional() });
const common = { dependencies: [], filePath: 'src/__tests__/core/StaleCrudCopy.spec.ts', permissions: [] };
const visibility = { get: 'public', find: 'public', create: 'public' } as const;

function described(key: string): { output: string; returns: string; input: string } {
    const contract = globalContractRegistry.get(key);
    if (contract === undefined) throw new Error(`${key} is not registered`);
    return {
        output: JSON.stringify(declarationOf(contract)?.output),
        returns: JSON.stringify(toolInfoOf(contract).returns),
        input: JSON.stringify(declarationOf(contract)?.input),
    };
}

describe('a stale copy of a CRUD collection in the same process', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    afterAll(() => warn.mockRestore());

    describe('stale copy first (edge1): the contract registry keeps the stale contract', () => {
        defineCrud('stalefirstzone', ZoneSchema, { ...common, visibility });
        defineCrud('stalefirstzone', ZoneSchema, { ...common, visibility, hidden: ['secretKey'] });

        it('describes get and find without the hidden field', () => {
            for (const key of ['stalefirstzone.get', 'stalefirstzone.find']) {
                const { output, returns } = described(key);
                expect(output).toContain('"name"');
                expect(output).not.toContain('secretKey');
                expect(returns).not.toContain('secretKey');
            }
        });

        it('still describes the field as an input: hidden is about what leaves, not what is accepted', () => {
            expect(described('stalefirstzone.create').input).toContain('secretKey');
        });
    });

    describe('stale copy last: the CRUD registry would take the stale copy', () => {
        defineCrud('stalelastzone', ZoneSchema, { ...common, visibility, hidden: ['secretKey'] });
        defineCrud('stalelastzone', ZoneSchema, { ...common, visibility });

        it('keeps the field hidden for the executor, and says the copies disagree', () => {
            expect(globalCrudRegistry.get('stalelastzone')?.hidden).toEqual(['secretKey']);
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('"stalelastzone"'));
        });

        it('describes get without the hidden field', () => {
            expect(described('stalelastzone.get').output).not.toContain('secretKey');
        });
    });
});
