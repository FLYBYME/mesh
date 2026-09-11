/**
 * **A projected read must still be filtered by the contract's output schema.**
 *
 * `ServiceBroker` validates every result against `schema.returns` on the way out, and zod strips
 * keys the schema does not declare. That stripping is not a formality — it is the only thing
 * standing between a collection's stored document and its caller, and a contract that declares an
 * `outputSchema` without a secret field is *relying* on it.
 *
 * Except when `fields` was passed. Then the broker returned the handler's result untouched:
 *
 *     const isCrudProjection = schema.isCrud && ctx.params && (ctx.params.fields !== undefined);
 *     if (isCrudProjection) {
 *         return result;
 *     }
 *
 * The reason was sound. A projection returns a *partial* document, so a schema whose fields are
 * required rejects it — `user.find({ fields: 'email' })` has no `createdAt`, and parsing would fail
 * on a read that is perfectly valid. Skipping the parse made projections work.
 *
 * It also made the output schema optional from the caller's side. Anyone who wanted the unfiltered
 * document only had to ask for a projection, **including a projection naming the very field the
 * schema was written to withhold** — `fields: 'passwordHash'` projects it in mongo and then returns
 * it unparsed. The guarantee was one query parameter deep.
 *
 * So: keep tolerating the missing fields, stop tolerating the extra ones. The schema is made
 * partial for a projected read and the parse still runs, which strips exactly as before.
 *
 * Frozen-repo note: this is a defect in existing behaviour, which `docs/STABILITY.md` allows. No
 * signature changes, nothing added to a registry, nothing removed. A caller who was relying on
 * receiving undeclared fields from a projected read was relying on the bug.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { ServiceBroker } from '../core/ServiceBroker.js';

/**
 * The shape at issue: a stored document with a secret, and a contract that declares everything
 * except the secret. `userCrud` in mesh-serve is exactly this, which is why every one of its
 * actions is `internal` — the marking is currently the only thing holding the line.
 */
const StoredUser = {
    id: 'u-1',
    email: 'operator@node.invalid',
    displayName: 'First operator',
    passwordHash: '$2b$12$THIS-MUST-NEVER-LEAVE-THE-SERVER',
};

const PublicUser = z.object({
    id: z.string(),
    email: z.string(),
    displayName: z.string(),
});

describe('a crud projection is still filtered by the output schema', () => {
    /**
     * `applyReturns` is the one decision this is about, lifted out of the two call sites so it can
     * be exercised without standing a broker and a database up. If the broker stops using it, these
     * tests keep passing while the leak returns — so `guards the real call sites` below checks that
     * too, by reading the source.
     */
    const applyReturns = (
        returns: z.ZodTypeAny,
        projected: boolean,
        result: unknown,
    ): unknown => ServiceBroker.applyReturns(returns, projected, result);

    it('strips an undeclared field from an unprojected read', () => {
        const out = applyReturns(PublicUser, false, StoredUser) as Record<string, unknown>;
        expect(out['passwordHash']).toBeUndefined();
        expect(out['email']).toBe('operator@node.invalid');
    });

    it('strips an undeclared field from a projected read — the bug', () => {
        // Before the fix this returned `result` untouched and the hash came back.
        const out = applyReturns(PublicUser, true, StoredUser) as Record<string, unknown>;
        expect(out['passwordHash']).toBeUndefined();
    });

    it('still allows a projected read to be missing declared fields', () => {
        // The reason the bypass existed: `fields: 'email'` returns no displayName and no id.
        const partial = { email: 'operator@node.invalid' };
        const out = applyReturns(PublicUser, true, partial) as Record<string, unknown>;
        expect(out['email']).toBe('operator@node.invalid');
        expect(out['displayName']).toBeUndefined();
    });

    it('still rejects a missing field when the read was not projected', () => {
        // Partiality is granted *because* a projection was asked for, not in general. A handler
        // that drops a required field on an ordinary read is still a bug and must still be caught.
        expect(() => applyReturns(PublicUser, false, { email: 'a@b.c' })).toThrow();
    });

    it('applies to an array return, which is what find gives back', () => {
        const out = applyReturns(z.array(PublicUser), true, [StoredUser]) as Record<string, unknown>[];
        expect(out[0]?.['passwordHash']).toBeUndefined();
        expect(out[0]?.['email']).toBe('operator@node.invalid');
    });

    it('applies through a nullable return, which is what find_one and get give back', () => {
        const out = applyReturns(PublicUser.nullable(), true, StoredUser) as Record<string, unknown>;
        expect(out['passwordHash']).toBeUndefined();
        expect(applyReturns(PublicUser.nullable(), true, null)).toBeNull();
    });

    it('leaves a non-object return alone, which is what count gives back', () => {
        expect(applyReturns(z.number(), true, 7)).toBe(7);
    });

    /**
     * The tests above exercise `applyReturns` directly, which proves the helper is right and proves
     * nothing about whether the broker uses it. The original defect was two inline copies of this
     * decision, so the failure mode to guard is a third copy — or one of the two drifting back.
     *
     * Reading the source is a blunt instrument and it is the right one here: the property is
     * *"there is exactly one place that decides this"*, which is a fact about the file rather than
     * about a value any call could return.
     */
    it('guards the real call sites: nothing returns a crud result unparsed', () => {
        // `__dirname` rather than `import.meta.url`: jest runs this through ts-jest as CommonJS.
        const source = readFileSync(join(__dirname, '..', 'core', 'ServiceBroker.ts'), 'utf8');

        // Every use of the projection flag must hand off to the helper rather than decide locally.
        const decisions = source.match(/isCrudProjection/g) ?? [];
        const handoffs = source.match(/ServiceBroker\.applyReturns\(/g) ?? [];

        // One mention per call site where the flag is computed, plus the two in the doc comment
        // above `applyReturns` that quote the old code.
        expect(handoffs.length).toBeGreaterThanOrEqual(2);
        expect(decisions.length).toBeGreaterThan(0);

        // The shape that was the bug: returning the raw result because a projection was asked for.
        expect(source).not.toMatch(/if\s*\(isCrudProjection\)\s*\{\s*return result;/);
    });
});
