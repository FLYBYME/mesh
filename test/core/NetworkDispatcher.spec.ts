import { NetworkDispatcher } from '../../src/core/NetworkDispatcher.js';
import { ILogger } from '../../src/interfaces/ILogger.js';
import { MeshPacket } from '../../src/interfaces/IMeshNetwork.js';

describe('NetworkDispatcher', () => {
    let dispatcher: NetworkDispatcher;
    let mockLogger: jest.Mocked<ILogger>;

    beforeEach(() => {
        mockLogger = {
            info: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
            warn: jest.fn()
        } as any;
        dispatcher = new NetworkDispatcher(mockLogger);
    });

    describe('on / hasHandler', () => {
        it('should register and check for exact handlers', () => {
            dispatcher.on('foo.bar', jest.fn());
            expect(dispatcher.hasHandler('foo.bar')).toBe(true);
            expect(dispatcher.hasHandler('foo.baz')).toBe(false);
        });

        it('should register and check for wildcard handlers', () => {
            dispatcher.on('foo.*', jest.fn());
            expect(dispatcher.hasHandler('foo.bar')).toBe(true);
            expect(dispatcher.hasHandler('foo.baz')).toBe(true);
            expect(dispatcher.hasHandler('bar.baz')).toBe(false);
        });

        it('should register and check for global wildcard handlers', () => {
            dispatcher.on('*', jest.fn());
            expect(dispatcher.hasHandler('any.topic')).toBe(true);
            expect(dispatcher.hasHandler('another.topic')).toBe(true);
        });
    });

    describe('dispatch', () => {
        it('should dispatch to exact match handler', async () => {
            const handler = jest.fn();
            dispatcher.on('test.topic', handler);

            const packet: MeshPacket = {
                id: '1',
                topic: 'test.topic',
                data: { foo: 'bar' },
                senderNodeID: 'node1',
                timestamp: Date.now(),
                version: 1,
                priority: 1,
                type: 'EVENT'
            } as any;

            await dispatcher.dispatch(packet);

            expect(handler).toHaveBeenCalledWith(packet.data, packet);
        });

        it('should dispatch to multiple exact match handlers', async () => {
            const handler1 = jest.fn();
            const handler2 = jest.fn();
            dispatcher.on('test.topic', handler1);
            dispatcher.on('test.topic', handler2);

            const packet: MeshPacket = {
                id: '1',
                topic: 'test.topic',
                data: { foo: 'bar' },
                senderNodeID: 'node1',
                timestamp: Date.now(),
                version: 1,
                priority: 1,
                type: 'EVENT'
            } as any;

            await dispatcher.dispatch(packet);

            expect(handler1).toHaveBeenCalledWith(packet.data, packet);
            expect(handler2).toHaveBeenCalledWith(packet.data, packet);
        });

        it('should dispatch to prefix match handlers', async () => {
            const handler = jest.fn();
            dispatcher.on('foo.*', handler);

            const packet: MeshPacket = {
                id: '1',
                topic: 'foo.bar',
                data: { val: 1 },
                senderNodeID: 'node1',
                timestamp: Date.now(),
                version: 1,
                priority: 1,
                type: 'EVENT'
            } as any;

            await dispatcher.dispatch(packet);

            expect(handler).toHaveBeenCalledWith(packet.data, packet);
        });

        it('should dispatch to global wildcard handlers', async () => {
            const handler = jest.fn();
            dispatcher.on('*', handler);

            const packet: MeshPacket = {
                id: '1',
                topic: 'any.thing',
                data: { val: 2 },
                senderNodeID: 'node1',
                timestamp: Date.now(),
                version: 1,
                priority: 1,
                type: 'EVENT'
            } as any;

            await dispatcher.dispatch(packet);

            expect(handler).toHaveBeenCalledWith(packet.data, packet);
        });

        it('should dispatch to both exact and wildcard handlers', async () => {
            const exactHandler = jest.fn();
            const wildcardHandler = jest.fn();
            const globalHandler = jest.fn();

            dispatcher.on('foo.bar', exactHandler);
            dispatcher.on('foo.*', wildcardHandler);
            dispatcher.on('*', globalHandler);

            const packet: MeshPacket = {
                id: '1',
                topic: 'foo.bar',
                data: { val: 3 },
                senderNodeID: 'node1',
                timestamp: Date.now(),
                version: 1,
                priority: 1,
                type: 'EVENT'
            } as any;

            await dispatcher.dispatch(packet);

            expect(exactHandler).toHaveBeenCalled();
            expect(wildcardHandler).toHaveBeenCalled();
            expect(globalHandler).toHaveBeenCalled();
        });

        it('should handle __direct packets', async () => {
            const handler = jest.fn();
            dispatcher.on('real.topic', handler);

            const packet: MeshPacket = {
                id: '1',
                topic: '__direct',
                data: { topic: 'real.topic', data: { inner: 'data' } },
                senderNodeID: 'node1',
                timestamp: Date.now(),
                version: 1,
                priority: 1,
                type: 'EVENT'
            } as any;

            await dispatcher.dispatch(packet);

            expect(handler).toHaveBeenCalledWith({ inner: 'data' }, packet);
        });

        it('should warn if packet has no topic', async () => {
            const packet: MeshPacket = {
                id: '1',
                topic: '',
                data: {},
                senderNodeID: 'node1',
                timestamp: Date.now(),
                version: 1,
                priority: 1,
                type: 'EVENT'
            } as any;

            await dispatcher.dispatch(packet);
            expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Received packet without topic'), expect.anything());
        });

        it('should not crash if no handlers are registered', async () => {
            const packet: MeshPacket = {
                id: '1',
                topic: 'no.handler',
                data: {},
                senderNodeID: 'node1',
                timestamp: Date.now(),
                version: 1,
                priority: 1,
                type: 'EVENT'
            } as any;

            await expect(dispatcher.dispatch(packet)).resolves.not.toThrow();
            expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('No handler registered for topic: no.handler'), expect.anything());
        });

        it('should handle errors in handlers', async () => {
            const errorHandler = jest.fn().mockRejectedValue(new Error('Handler error'));
            const successHandler = jest.fn();

            dispatcher.on('test', errorHandler);
            dispatcher.on('test', successHandler);

            const packet: MeshPacket = {
                id: '1',
                topic: 'test',
                data: {},
                senderNodeID: 'node1',
                timestamp: Date.now(),
                version: 1,
                priority: 1,
                type: 'EVENT'
            } as any;

            await expect(dispatcher.dispatch(packet)).rejects.toThrow('Handler error');
            // Depending on implementation, it might stop at the first error or continue.
            // Current implementation uses 'await handler(data, packet)' in a for loop, so it stops.
        });
    });

    describe('stop', () => {
        it('should clear all handlers', () => {
            dispatcher.on('foo', jest.fn());
            dispatcher.on('bar.*', jest.fn());
            dispatcher.on('*', jest.fn());

            expect(dispatcher.hasHandler('foo')).toBe(true);
            expect(dispatcher.hasHandler('bar.baz')).toBe(true);
            expect(dispatcher.hasHandler('any')).toBe(true);

            dispatcher.stop();

            expect(dispatcher.hasHandler('foo')).toBe(false);
            expect(dispatcher.hasHandler('bar.baz')).toBe(false);
            expect(dispatcher.hasHandler('any')).toBe(false);
        });
    });
});
