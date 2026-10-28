import { BoundedMap, BoundedSet } from '../utils/Bounded.js';
import { ServiceBroker } from '../core/ServiceBroker.js';
import { Logger } from '../utils/Logger.js';
import { LogLevel } from '../interfaces/ILogger.js';

/**
 * Records kept per node id or address a node meets, and locks per key, stay bounded however many
 * it meets (CHECKLIST 1, "Unbounded maps and timers").
 */
describe('bounded records', () => {
    it('a BoundedMap keeps its newest entries, a key set again counting as new', () => {
        const map = new BoundedMap<string, number>(3);
        for (const k of ['a', 'b', 'c']) map.set(k, 1);
        map.set('a', 2);
        map.set('d', 1);

        expect([...map.keys()]).toEqual(['c', 'a', 'd']);
        expect(map.get('a')).toBe(2);
    });

    it('a BoundedSet likewise', () => {
        const set = new BoundedSet<string>(2);
        for (const v of ['x', 'y', 'x', 'z']) set.add(v);

        expect([...set]).toEqual(['x', 'z']);
    });

    it('10 000 peers met: still the limit, not 10 000', () => {
        const map = new BoundedMap<string, number>(4096);
        for (let i = 0; i < 10_000; i++) map.set(`node-${i}`, i);

        expect(map.size).toBe(4096);
        expect(map.has('node-9999')).toBe(true);
        expect(map.has('node-0')).toBe(false);
    });

    it('locks that expired unreleased are swept, held ones kept', async () => {
        const broker = new ServiceBroker('bounded-locks', new Logger(LogLevel.ERROR));
        const held = await broker.acquire('held', { ttlMs: 20_000 });
        for (let i = 0; i < 1100; i++) await broker.acquire(`gone-${i}`, { ttlMs: 1 });
        await new Promise((r) => setTimeout(r, 5));
        await broker.acquire('one-more', { ttlMs: 20_000 });

        const size = Reflect.get(broker, 'locks') instanceof Map ? Reflect.get(broker, 'locks').size : -1;
        expect(size).toBeLessThan(1100);
        await expect(broker.acquire('held', { waitMs: 0 })).rejects.toMatchObject({ code: 'LOCK_TIMEOUT' });
        broker.release('held', held.token);
    });
});
