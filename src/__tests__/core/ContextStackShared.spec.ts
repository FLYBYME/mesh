import { ContextStack } from '../../core/ContextStack.js';
import type { IContext } from '../../interfaces/IContext.js';

/**
 * Two copies of mesh in one process -- a bundled part's and the node's -- see one context. The api
 * gateway runs from a precompiled part: a request's context set with its copy was invisible to the
 * broker's, so every request still ran in the context its server was started in.
 */
const ctx: IContext = {
    id: 'request', correlationID: 'request', toolName: 'serve.api.request', params: {}, meta: {},
    callerID: null, nodeID: 'n', traceId: 'the-request-trace', spanId: 's',
};

describe('the context store, across copies of the package', () => {
    it('a context set by one copy is the one another copy reads', async () => {
        let other: { getContext(): IContext | undefined; run<T>(c: IContext, fn: () => T): T } | undefined;
        await jest.isolateModulesAsync(async () => {
            other = (await import('../../core/ContextStack.js')).ContextStack;
        });

        expect(other).toBeDefined();
        expect(other).not.toBe(ContextStack);

        expect(ContextStack.run(ctx, () => other?.getContext()?.traceId)).toBe('the-request-trace');
        expect(other?.run(ctx, () => ContextStack.getContext()?.traceId)).toBe('the-request-trace');
    });
});
