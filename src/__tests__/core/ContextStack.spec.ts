import { ContextStack } from '../../core/ContextStack.js';
import type { IContext } from '../../interfaces/IContext.js';

describe('ContextStack', () => {
    const createContext = (id: string): IContext => ({
        id,
        correlationID: `corr-${id}`,
        toolName: 'test.tool',
        params: {},
        meta: {},
        callerID: null,
        nodeID: 'test-node',
        traceId: `trace-${id}`,
        spanId: `span-${id}`,
    });

    describe('run() / getContext()', () => {
        it('should set context within run callback', () => {
            const ctx = createContext('1');
            ContextStack.run(ctx, () => {
                const current = ContextStack.getContext();
                expect(current).toBeDefined();
                expect(current!.id).toBe('1');
            });
        });

        it('should isolate context between nested runs', () => {
            const outer = createContext('outer');
            const inner = createContext('inner');

            ContextStack.run(outer, () => {
                expect(ContextStack.getContext()!.id).toBe('outer');

                ContextStack.run(inner, () => {
                    expect(ContextStack.getContext()!.id).toBe('inner');
                });

                // After inner run, outer should be restored
                expect(ContextStack.getContext()!.id).toBe('outer');
            });
        });

        it('should propagate context through async operations', async () => {
            const ctx = createContext('async');
            await ContextStack.run(ctx, async () => {
                // Simulate async operation
                await new Promise(resolve => setTimeout(resolve, 10));
                const current = ContextStack.getContext();
                expect(current).toBeDefined();
                expect(current!.id).toBe('async');
            });
        });

        it('should isolate context between concurrent async runs', async () => {
            const ids: string[] = [];

            const run1 = ContextStack.run(createContext('concurrent-1'), async () => {
                await new Promise(resolve => setTimeout(resolve, 20));
                ids.push(ContextStack.getContext()!.id);
            });

            const run2 = ContextStack.run(createContext('concurrent-2'), async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
                ids.push(ContextStack.getContext()!.id);
            });

            await Promise.all([run1, run2]);
            expect(ids).toContain('concurrent-1');
            expect(ids).toContain('concurrent-2');
        });

        it('should return undefined outside of a run', () => {
            const ctx = ContextStack.getContext();
            expect(ctx).toBeUndefined();
        });
    });
});
