import { MeshError, ClientError, ResiliencyError, isMeshError, errorFromWire, MESH_ERROR_BRAND } from '../../core/MeshError.js';

/**
 * `instanceof MeshError` is not reliable, and the failure is silent.
 *
 * A node running under `tsx` loads `@flybyme/mesh` twice -- once through the ESM loader for its own
 * imports, once through `require()` when it loads a precompiled `.cjs` part -- and those are two
 * distinct `MeshError` classes. So a handler inside a loaded part throws a perfectly good 404, the
 * broker checks `instanceof` in the other realm, gets false, and ships it as a bare message. The
 * caller then answers 500.
 *
 * That went unnoticed through two rounds of fixing the wrong thing, because every test here runs in
 * one realm where `instanceof` works fine. These tests simulate the second realm the only way that
 * is honest in-process: an error that satisfies the brand without deriving from *this* copy of the
 * class.
 */
describe('MeshError identity across module copies', () => {
    /** What a second copy of this module produces: same shape, same brand, different class. */
    class ForeignMeshError extends Error {
        public readonly [MESH_ERROR_BRAND] = true as const;
        constructor(message: string, public readonly code: string, public readonly status: number) {
            super(message);
            this.name = 'MeshError';
        }
        public toJSON(): Record<string, unknown> {
            return { message: this.message, code: this.code, status: this.status };
        }
    }

    it('recognizes its own errors', () => {
        expect(isMeshError(new MeshError({ message: 'x', code: 'NOT_FOUND', status: 404 }))).toBe(true);
    });

    it('recognizes the subclasses', () => {
        expect(isMeshError(new ClientError('bad'))).toBe(true);
        expect(isMeshError(new ResiliencyError('busy'))).toBe(true);
    });

    it('recognizes one from another copy of the module, which instanceof cannot', () => {
        const foreign = new ForeignMeshError('No such account.', 'NOT_FOUND', 404);

        expect(foreign instanceof MeshError).toBe(false);   // the bug, in one line
        expect(isMeshError(foreign)).toBe(true);
    });

    it('is not fooled by an ordinary Error, or by a lookalike without the brand', () => {
        expect(isMeshError(new Error('plain'))).toBe(false);
        expect(isMeshError({ message: 'x', code: 'NOT_FOUND', status: 404 })).toBe(false);
        expect(isMeshError(undefined)).toBe(false);
        expect(isMeshError(null)).toBe(false);
        expect(isMeshError('NOT_FOUND')).toBe(false);
    });

    it('uses the global symbol registry, so separate copies agree on the key', () => {
        // This is the whole mechanism: a second copy of the module calls Symbol.for with the same
        // string and gets the same symbol back.
        expect(MESH_ERROR_BRAND).toBe(Symbol.for('@flybyme/mesh.MeshError'));
    });

    describe('errorFromWire', () => {
        it('rebuilds a MeshError when code and status both arrived', () => {
            const err = errorFromWire({ message: 'No such account.', code: 'NOT_FOUND', status: 404 });
            expect(isMeshError(err)).toBe(true);
            expect((err as MeshError).status).toBe(404);
            expect((err as MeshError).code).toBe('NOT_FOUND');
            expect(err.message).toBe('No such account.');
        });

        it('leaves a plain error plain -- it had no status to lose', () => {
            const err = errorFromWire({ message: 'something came loose' });
            expect(isMeshError(err)).toBe(false);
            expect(err.message).toBe('something came loose');
        });

        it('needs both code and status, since neither means anything alone', () => {
            expect(isMeshError(errorFromWire({ message: 'x', code: 'NOT_FOUND' }))).toBe(false);
            expect(isMeshError(errorFromWire({ message: 'x', status: 404 }))).toBe(false);
        });

        it('round-trips a foreign copy through the wire shape', () => {
            // The real path: a part in another realm throws, the broker serializes with toJSON,
            // and the far side rebuilds. Nothing here can rely on instanceof.
            const thrown = new ForeignMeshError('No such account.', 'NOT_FOUND', 404);
            const wire = isMeshError(thrown) ? thrown.toJSON() : { message: thrown.message };

            const rebuilt = errorFromWire(wire);
            expect(isMeshError(rebuilt)).toBe(true);
            expect((rebuilt as MeshError).status).toBe(404);
        });

        it('keeps the far side\'s stack behind a boundary marker', () => {
            const err = errorFromWire({ message: 'x', code: 'NOT_FOUND', status: 404, stack: 'MeshError: x\n    at somewhere' });
            expect(err.stack).toContain('at somewhere');
            expect(err.stack).toContain('--- Remote Boundary ---');
        });

        it('falls back to a usable message rather than an empty one', () => {
            expect(errorFromWire({}).message).toBe('Remote RPC Error');
            expect(errorFromWire(undefined, 'RPC Error').message).toBe('RPC Error');
        });
    });
});
