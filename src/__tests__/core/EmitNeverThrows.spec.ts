import { setImmediate as nextTurn } from 'node:timers/promises';
import { ServiceBroker } from '../../core/ServiceBroker.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';

declare global {
    interface EventRegistry {
        'emitnever.happened': { n: number };
    }
}

/**
 * `emit` is synchronous and never throws (10-10): a listener that throws, or rejects, is logged and
 * the other listeners still hear the event. Every service had wrapped its emits in try/catch "in
 * case" -- eventemitter3 stopped at the first listener that threw and threw it into the emitter.
 */
describe('emit never throws', () => {
    it('a listener that throws, or rejects, is logged; the next still hears it; emit returns', async () => {
        const broker = new ServiceBroker('emit-never', new Logger(LogLevel.ERROR));
        const heard: number[] = [];

        broker.on('emitnever.happened', () => {
            throw new Error('a bug in the first listener');
        });
        broker.on('emitnever.happened', async () => {
            throw new Error('a rejection in the second');
        });
        broker.on('emitnever.happened', (payload) => {
            heard.push(payload.n);
        });

        expect(() => broker.emit('emitnever.happened', { n: 7 }, { skipNetwork: true })).not.toThrow();
        expect(heard).toEqual([7]);

        // The rejection is handled (logged), never unhandled.
        await nextTurn();
    });
});
