import { MeshError } from '../../core/MeshError.js';
import { ServiceBroker } from '../../core/ServiceBroker.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';

/**
 * withLock's whole job: two callers racing the same key never run their fn concurrently, two
 * callers on different keys never wait on each other, and a rejection doesn't wedge the queue.
 * Pure in-process logic -- no registry, no network, no database needed to prove it.
 */
describe('ServiceBroker.withLock', () => {
    let broker: ServiceBroker;

    beforeEach(() => {
        broker = new ServiceBroker('withlock-test-node', new Logger(LogLevel.ERROR));
    });

    it('never runs two fns for the same key concurrently', async () => {
        let inFlight = 0;
        let maxObservedConcurrency = 0;
        const order: number[] = [];

        const task = (n: number) => broker.withLock('same-key', async () => {
            inFlight++;
            maxObservedConcurrency = Math.max(maxObservedConcurrency, inFlight);
            await new Promise((r) => setTimeout(r, 20));
            order.push(n);
            inFlight--;
            return n;
        });

        const results = await Promise.all([task(1), task(2), task(3)]);

        expect(maxObservedConcurrency).toBe(1);
        // Each call queued in call order (task(1) invoked first), so it also completes in that order.
        expect(order).toEqual([1, 2, 3]);
        expect(results).toEqual([1, 2, 3]);
    });

    it('does not serialize different keys against each other', async () => {
        let concurrentAcrossKeys = 0;
        let maxObserved = 0;

        const task = (key: string) => broker.withLock(key, async () => {
            concurrentAcrossKeys++;
            maxObserved = Math.max(maxObserved, concurrentAcrossKeys);
            await new Promise((r) => setTimeout(r, 20));
            concurrentAcrossKeys--;
        });

        await Promise.all([task('key-a'), task('key-b'), task('key-c')]);

        expect(maxObserved).toBeGreaterThan(1);
    });

    it('a rejected fn does not deadlock callers queued behind it on the same key', async () => {
        const first = broker.withLock('failing-key', async () => {
            throw new Error('first holder failed');
        });
        const second = broker.withLock('failing-key', async () => 'second holder ran');

        await expect(first).rejects.toThrow('first holder failed');
        await expect(second).resolves.toBe('second holder ran');
    });

    it('propagates each call\'s own result to its own caller, not a neighbor\'s', async () => {
        const results = await Promise.all([
            broker.withLock('shared', async () => 'a'),
            broker.withLock('shared', async () => 'b'),
            broker.withLock('shared', async () => 'c'),
        ]);
        expect(results).toEqual(['a', 'b', 'c']);
    });

    it('a key with nothing queued behind it accepts a fresh call immediately, not after a stale wait', async () => {
        await broker.withLock('reusable', async () => undefined);
        const start = Date.now();
        await broker.withLock('reusable', async () => undefined);
        expect(Date.now() - start).toBeLessThan(50);
    });
});

describe('ServiceBroker.acquire/release: TTL and fencing', () => {
    let broker: ServiceBroker;

    beforeEach(() => {
        broker = new ServiceBroker('lock-ttl-test-node', new Logger(LogLevel.ERROR));
    });

    it('acquire throws if the key is still held once waitMs elapses', async () => {
        await broker.acquire('busy-key', { ttlMs: 5000 });
        await expect(broker.acquire('busy-key', { waitMs: 50 })).rejects.toThrow(/Could not acquire lock "busy-key"/);
    });

    it('a lock becomes claimable again once its TTL passes, with no release ever called -- the crash/bug case', async () => {
        const { token: firstToken } = await broker.acquire('abandoned-key', { ttlMs: 30 });
        // Simulate a holder that crashed or hung: never call release.
        await new Promise((r) => setTimeout(r, 60));
        const { token: secondToken } = await broker.acquire('abandoned-key', { waitMs: 200 });
        expect(secondToken).not.toBe(firstToken);
    });

    it('a stale token\'s release is a no-op -- it can never tear down whoever holds the lock now', async () => {
        const { token: staleToken } = await broker.acquire('fenced-key', { ttlMs: 20 });
        await new Promise((r) => setTimeout(r, 40)); // let it expire
        const { token: currentToken } = await broker.acquire('fenced-key', { ttlMs: 5000 });

        broker.release('fenced-key', staleToken); // the late, stale release

        // The current holder's own lock must still be intact -- a third party can't acquire it.
        await expect(broker.acquire('fenced-key', { waitMs: 50 })).rejects.toThrow(/Could not acquire/);

        // The real holder's own release still works, using its own real token.
        broker.release('fenced-key', currentToken);
        await expect(broker.acquire('fenced-key', { waitMs: 50 })).resolves.toBeDefined();
    });

    it('refuses a ttlMs beyond the hard cap rather than silently clamping it', async () => {
        await expect(broker.acquire('capped-key', { ttlMs: 60_000 })).rejects.toThrow(MeshError);
    });

    it('withLock still respects ttlMs/waitMs options passed through it', async () => {
        // Hold the lock past its own short TTL by never resolving -- withLock's own release (in
        // `finally`) races the fn itself, but the TTL is what frees the key for the next waiter
        // regardless of whether fn ever finishes.
        const stuck = broker.withLock('wl-ttl-key', () => new Promise(() => { /* never resolves */ }), { ttlMs: 30 });
        void stuck.catch(() => { /* this call itself is expected to hang; only its lock matters here */ });

        await new Promise((r) => setTimeout(r, 60));
        await expect(broker.withLock('wl-ttl-key', async () => 'freed', { waitMs: 200 })).resolves.toBe('freed');
    });
});
