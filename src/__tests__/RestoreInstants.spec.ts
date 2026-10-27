/**
 * **A reply that was correct when sent is correct when received.**
 *
 * The JSON codec revives every full ISO instant into a `Date`, so a `z.string()` field holding a
 * timestamp failed its own schema on the far side: `serve.node.inspect`'s `closesAt` made every
 * open a 500 (10-27), while a local call passed. `restoreInstants` puts the string back where the
 * schema wants one, and leaves a `z.date()` field its `Date`.
 */
import { z } from 'zod';

import { ServiceBroker } from '../core/ServiceBroker.js';
import { JSONSerializer } from '../serializers/JSONSerializer.js';

const codec = new JSONSerializer();
const overTheWire = (value: unknown): unknown => codec.deserialize(codec.serialize(value));

describe('restoreInstants', () => {
    const Reply = z.object({
        nodeID: z.string(),
        closesAt: z.string().optional(),
        createdAt: z.date(),
        history: z.array(z.object({ at: z.string() })),
        byNode: z.record(z.string(), z.string().nullable()),
        either: z.union([z.string(), z.number()]).default(0),
    });
    const at = '2026-10-27T19:49:28.022Z';
    const sent = {
        nodeID: 'stream',
        closesAt: at,
        createdAt: new Date(at),
        history: [{ at }],
        byNode: { stream: at, core: null },
        either: at,
    };

    it('the codec still turns the string into a Date (the reason for this)', () => {
        expect(Reflect.get(Object(overTheWire(sent)), 'closesAt')).toBeInstanceOf(Date);
        expect(() => Reply.parse(overTheWire(sent))).toThrow();
    });

    it('a reply checked after the wire parses as it did before it', () => {
        const received = ServiceBroker.applyReturns(Reply, false, overTheWire(sent));

        expect(received).toEqual(sent);
    });

    it('a projected reply too', () => {
        const received = ServiceBroker.applyReturns(Reply, true, overTheWire({ closesAt: at }));

        expect(received).toEqual({ closesAt: at });
    });

    it('a z.date() field keeps its Date, and a union that takes dates is left alone', () => {
        const Dates = z.object({ when: z.date(), maybe: z.union([z.string(), z.date()]) });
        const value = { when: new Date(at), maybe: new Date(at) };

        expect(ServiceBroker.restoreInstants(Dates, value)).toBe(value);
    });

    it('nothing to restore: the same value back, not a copy', () => {
        const value = { nodeID: 'core', history: [{ at: 'yesterday' }] };

        expect(ServiceBroker.restoreInstants(Reply, value)).toBe(value);
    });

    it('a class instance is not walked into', () => {
        class Holder { at = new Date(at); }
        const value = new Holder();

        expect(ServiceBroker.restoreInstants(z.object({ at: z.string() }), value)).toBe(value);
    });
});
