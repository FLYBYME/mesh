import { z } from 'zod';
import { MeshApp } from '../../core/MeshApp.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { PlacementRegistry } from '../../core/PlacementRegistry.js';
import { ServiceBroker } from '../../core/ServiceBroker.js';
import { defineContract, defaultPrint } from '../../interfaces/IToolContract.js';
import type { IServiceBroker } from '../../interfaces/IServiceBroker.js';

/**
 * `ctx.signal` and `concurrency: 'interval'` -- the two things that make a long-running or
 * recurring job expressible as an ordinary contract, with no class, no `onStart`/`onStop` pair and
 * no hand-written timer.
 *
 * The property under test throughout is *lifetime*: an on-demand contract's signal belongs to one
 * invocation, a long-running one's belongs to the registration and is what stops it. Getting that
 * backwards is silent in both directions -- a long-running handler whose signal aborts between
 * calls tears its own listener down mid-flight, and an on-demand one whose signal never aborts
 * leaks every request's cleanup -- so both directions are asserted here rather than assumed.
 */

const onDemandContract = defineContract({
    domain: 'lifecycle',
    action: 'once',
    description: 'An ordinary call-and-return contract.',
    inputSchema: z.object({}),
    outputSchema: z.object({ ok: z.boolean() }),
    filePath: 'src/__tests__/core/ContractLifecycle.spec.ts',
    concurrency: 'on-demand',
    permissions: [],
    print: defaultPrint,
});

const listenContract = defineContract({
    domain: 'lifecycle',
    action: 'listen',
    description: 'Stands in for a real listener: starts something, hands teardown to ctx.signal.',
    inputSchema: z.object({ port: z.number() }),
    outputSchema: z.object({ boundTo: z.number() }),
    filePath: 'src/__tests__/core/ContractLifecycle.spec.ts',
    concurrency: 'long-running',
    permissions: [],
    print: defaultPrint,
});

const tickContract = defineContract({
    domain: 'lifecycle',
    action: 'tick',
    description: 'A recurring job -- the broker owns the timer.',
    inputSchema: z.object({}),
    outputSchema: z.object({ n: z.number() }),
    filePath: 'src/__tests__/core/ContractLifecycle.spec.ts',
    concurrency: 'interval',
    intervalMs: 20,
    permissions: [],
    print: defaultPrint,
});

const leaderTickContract = defineContract({
    domain: 'lifecycle',
    action: 'leaderTick',
    description: 'A recurring job that must run on exactly one node.',
    inputSchema: z.object({}),
    outputSchema: z.object({ n: z.number() }),
    filePath: 'src/__tests__/core/ContractLifecycle.spec.ts',
    concurrency: 'interval',
    intervalMs: 20,
    leaderScoped: true,
    permissions: [],
    print: defaultPrint,
});

declare global {
    interface IServiceToolRegistry {
        'lifecycle.leaderTick': { params: Record<string, never>; returns: { n: number } };
        'lifecycle.once': { params: Record<string, never>; returns: { ok: boolean } };
        'lifecycle.listen': { params: { port: number }; returns: { boundTo: number } };
        'lifecycle.tick': { params: Record<string, never>; returns: { n: number } };
    }
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

describe('contract lifetime: ctx.signal and the built-in interval timer', () => {
    let app: MeshApp;
    let broker: ServiceBroker;

    beforeEach(async () => {
        app = new MeshApp({ nodeID: 'lifecycle-node', namespace: 'test', logger: new Logger(LogLevel.ERROR) });
        app.use(new RegistryModule({ preferLocal: true, implementation: PlacementRegistry }));
        app.use(new BrokerModule());
        await app.start();
        broker = app.getProvider<IServiceBroker>('broker') as ServiceBroker;
    });

    afterEach(async () => {
        await app.stop();
    });

    describe('ctx.signal', () => {
        it('is a real, live AbortSignal in an ordinary handler -- not undefined', async () => {
            let seen: AbortSignal | undefined;
            broker.registerContract(onDemandContract, async (_p, ctx) => {
                seen = ctx.signal;
                return { ok: true };
            });

            await broker.call('lifecycle.once', {});
            expect(seen).toBeInstanceOf(AbortSignal);
            expect(seen?.aborted).toBe(false);
        });

        it('gives an on-demand contract a *fresh* signal per call', async () => {
            const signals: AbortSignal[] = [];
            broker.registerContract(onDemandContract, async (_p, ctx) => {
                signals.push(ctx.signal);
                return { ok: true };
            });

            await broker.call('lifecycle.once', {});
            await broker.call('lifecycle.once', {});

            expect(signals).toHaveLength(2);
            expect(signals[0]).not.toBe(signals[1]);
        });

        it('gives a long-running contract the *same* signal across calls -- it belongs to the registration', async () => {
            const signals: AbortSignal[] = [];
            broker.registerContract(listenContract, async (params, ctx) => {
                signals.push(ctx.signal);
                return { boundTo: params.port };
            });

            await broker.call('lifecycle.listen', { port: 1 });
            await broker.call('lifecycle.listen', { port: 2 });

            expect(signals[0]).toBe(signals[1]);
            // Still live between calls: aborting per-call would fire the handler's own teardown
            // immediately after it returned, which is precisely the bug this distinction prevents.
            expect(signals[0]?.aborted).toBe(false);
        });

        it('aborts a long-running contract when it is unregistered -- the abort *is* the stop', async () => {
            let closed = false;
            broker.registerContract(listenContract, async (params, ctx) => {
                // Exactly the shape a real listener uses.
                ctx.signal.addEventListener('abort', () => { closed = true; });
                return { boundTo: params.port };
            });

            await broker.call('lifecycle.listen', { port: 8080 });
            expect(closed).toBe(false);

            broker.unregisterContract('lifecycle.listen');
            expect(closed).toBe(true);
        });

        it('aborts long-running contracts when the broker stops', async () => {
            let closed = false;
            broker.registerContract(listenContract, async (params, ctx) => {
                ctx.signal.addEventListener('abort', () => { closed = true; });
                return { boundTo: params.port };
            });
            await broker.call('lifecycle.listen', { port: 8080 });

            await app.stop();
            expect(closed).toBe(true);
        });
    });

    describe('concurrency: interval', () => {
        it('runs the handler on the broker-owned timer, with no setInterval in the handler', async () => {
            let ticks = 0;
            broker.registerContract(tickContract, async () => {
                ticks += 1;
                return { n: ticks };
            });

            await wait(120);
            // 20ms period over ~120ms; assert it recurred rather than an exact count, which would
            // just be a timer-precision test.
            expect(ticks).toBeGreaterThanOrEqual(2);
        });

        it('stops ticking once unregistered', async () => {
            let ticks = 0;
            broker.registerContract(tickContract, async () => {
                ticks += 1;
                return { n: ticks };
            });

            await wait(80);
            expect(ticks).toBeGreaterThan(0);

            broker.unregisterContract('lifecycle.tick');
            const atUnregister = ticks;
            await wait(80);
            expect(ticks).toBe(atUnregister);
        });

        it('never overlaps a tick with itself', async () => {
            let concurrent = 0;
            let maxConcurrent = 0;
            broker.registerContract(tickContract, async () => {
                concurrent += 1;
                maxConcurrent = Math.max(maxConcurrent, concurrent);
                // Deliberately far longer than the 20ms period.
                await wait(70);
                concurrent -= 1;
                return { n: 0 };
            });

            await wait(200);
            expect(maxConcurrent).toBe(1);
        });

        it('drops a tick on a node that is not the leader', async () => {
            // The guard that makes `leaderScoped` + `interval` a cluster singleton. Every node
            // loads the contract and starts a timer; only the leader's tick runs. It is checked
            // per tick rather than once, so leadership moving is picked up on the next one --
            // which is why no separate leadership watcher is needed for interval contracts.
            //
            // mesh-serve's build sweep depends on exactly this: without it, two nodes both find
            // the same pending artifact and both enqueue a build for it.
            let ticks = 0;
            const registry = broker.registry as unknown as { leaderFor: (d: string) => { nodeID: string } | undefined };
            const realLeaderFor = registry.leaderFor.bind(registry);
            registry.leaderFor = () => ({ nodeID: 'some-other-node' });

            try {
                broker.registerContract(leaderTickContract, async () => {
                    ticks += 1;
                    return { n: ticks };
                });
                await wait(120);
                expect(ticks).toBe(0);
            } finally {
                registry.leaderFor = realLeaderFor;
            }
        });

        it('runs the tick once this node is the leader', async () => {
            let ticks = 0;
            const registry = broker.registry as unknown as { leaderFor: (d: string) => { nodeID: string } | undefined };
            const realLeaderFor = registry.leaderFor.bind(registry);
            registry.leaderFor = () => ({ nodeID: broker.nodeID });

            try {
                broker.registerContract(leaderTickContract, async () => {
                    ticks += 1;
                    return { n: ticks };
                });
                await wait(120);
                expect(ticks).toBeGreaterThan(0);
            } finally {
                registry.leaderFor = realLeaderFor;
            }
        });

        it('keeps ticking after a handler throws', async () => {
            let ticks = 0;
            broker.registerContract(tickContract, async () => {
                ticks += 1;
                throw new Error('tick blew up');
            });

            await wait(120);
            expect(ticks).toBeGreaterThanOrEqual(2);
        });
    });

    describe('defineContract validation', () => {
        it('refuses concurrency interval without a period -- the broker cannot schedule it', () => {
            expect(() => defineContract({
                domain: 'lifecycle', action: 'badtick',
                description: 'x',
                inputSchema: z.object({}), outputSchema: z.object({}),
                filePath: 'src/__tests__/core/ContractLifecycle.spec.ts',
                concurrency: 'interval',
                permissions: [],
                print: defaultPrint,
            })).toThrow(/requires a positive "intervalMs"/);
        });

        it('refuses a period on a contract that is not an interval -- it would be silently ignored', () => {
            expect(() => defineContract({
                domain: 'lifecycle', action: 'badperiod',
                description: 'x',
                inputSchema: z.object({}), outputSchema: z.object({}),
                filePath: 'src/__tests__/core/ContractLifecycle.spec.ts',
                concurrency: 'on-demand',
                intervalMs: 500,
                permissions: [],
                print: defaultPrint,
            })).toThrow(/only meaningful with concurrency 'interval'/);
        });
    });
});
