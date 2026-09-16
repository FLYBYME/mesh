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
