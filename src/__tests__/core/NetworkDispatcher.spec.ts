import { NetworkDispatcher } from '../../core/NetworkDispatcher.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import type { MeshPacket } from '../../interfaces/IMeshNetwork.js';

describe('NetworkDispatcher', () => {
    let dispatcher: NetworkDispatcher;

    const createPacket = (topic: string, data: unknown = {}, type = 'REQUEST'): MeshPacket => ({
        id: `pkt-${Date.now()}`,
        topic,
        data,
        senderNodeID: 'sender-1',
        type: type as MeshPacket['type'] as any,
        timestamp: Date.now(),
        version: 1,
        priority: 1,
        meta: {}
    });

    beforeEach(() => {
        dispatcher = new NetworkDispatcher(new Logger(LogLevel.WARN));
    });

    afterEach(() => {
        dispatcher.stop();
    });

    // ─── exact match ─────────────────────────────────────────────────────────

    describe('exact topic matching', () => {
        it('should dispatch to exact topic handler', async () => {
            const received: unknown[] = [];
            dispatcher.on('demo.hello', (data) => { received.push(data); });

            await dispatcher.dispatch(createPacket('demo.hello', { name: 'test' }));
            expect(received).toHaveLength(1);
        });

        it('should not dispatch to non-matching handler', async () => {
            const received: unknown[] = [];
            dispatcher.on('demo.hello', (data) => { received.push(data); });

            await dispatcher.dispatch(createPacket('demo.goodbye', { name: 'test' }));
            expect(received).toHaveLength(0);
        });

        it('should support multiple handlers for same topic', async () => {
            const received: string[] = [];
            dispatcher.on('multi.topic', () => { received.push('handler-1'); });
            dispatcher.on('multi.topic', () => { received.push('handler-2'); });

            await dispatcher.dispatch(createPacket('multi.topic'));
            expect(received).toEqual(['handler-1', 'handler-2']);
        });
    });

    // ─── wildcard matching ───────────────────────────────────────────────────

    describe('wildcard matching', () => {
        it('should dispatch to global wildcard handler (*)', async () => {
            const received: unknown[] = [];
            dispatcher.on('*', (data) => { received.push(data); });

            await dispatcher.dispatch(createPacket('anything'));
            await dispatcher.dispatch(createPacket('something.else'));
            expect(received).toHaveLength(2);
        });

        it('should dispatch to prefix wildcard handler', async () => {
            const received: unknown[] = [];
            dispatcher.on('demo.*', (data) => { received.push(data); });

            await dispatcher.dispatch(createPacket('demo.hello'));
            await dispatcher.dispatch(createPacket('demo.status'));
            await dispatcher.dispatch(createPacket('other.topic'));
            expect(received).toHaveLength(2);
        });
    });

    // ─── hasHandler ──────────────────────────────────────────────────────────

    describe('hasHandler()', () => {
        it('should return true for registered exact topic', () => {
            dispatcher.on('registered.topic', () => { });
            expect(dispatcher.hasHandler('registered.topic')).toBe(true);
        });

        it('should return true for topics matching a prefix handler', () => {
            dispatcher.on('prefix.*', () => { });
            expect(dispatcher.hasHandler('prefix.anything')).toBe(true);
        });

        it('should return false for unregistered topics without prefix match', () => {
            dispatcher.on('specific.topic', () => { });
            expect(dispatcher.hasHandler('other.topic')).toBe(false);
        });
    });

    // ─── stop ────────────────────────────────────────────────────────────────

    describe('stop()', () => {
        it('should clear all handlers', async () => {
            const received: unknown[] = [];
            dispatcher.on('stop.test', (data) => { received.push(data); });

            dispatcher.stop();

            await dispatcher.dispatch(createPacket('stop.test'));
            expect(received).toHaveLength(0);
        });
    });

    // ─── __direct packets ────────────────────────────────────────────────────

    describe('__direct packets', () => {
        it('should unwrap __direct packets and route by inner topic', async () => {
            const received: unknown[] = [];
            dispatcher.on('inner.topic', (data) => { received.push(data); });

            const packet = createPacket('__direct', { topic: 'inner.topic', data: { key: 'value' } });
            await dispatcher.dispatch(packet);
            expect(received).toHaveLength(1);
            expect((received[0] as Record<string, unknown>).key).toBe('value');
        });
    });
});
