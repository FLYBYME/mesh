import { createTestApp, destroyTestApp, dropTestCollection } from '../helpers/setup.js';
import { MeshApp } from '../../core/MeshApp.js';
import { IServiceBroker } from '../../interfaces/IServiceBroker.js';
import { ServiceBroker } from '../../core/ServiceBroker.js';

describe('ServiceBroker', () => {
    let app: MeshApp;
    let broker: IServiceBroker;

    beforeAll(async () => {
        await dropTestCollection('demo');
        app = await createTestApp('broker-test-node');
        broker = app.getProvider<IServiceBroker>('broker');
    });

    afterAll(async () => {
        await destroyTestApp(app);
        const { dropTestDatabase } = await import('../helpers/setup.js');
        await dropTestDatabase();
    });

    // ─── local call ──────────────────────────────────────────────────────────

    describe('call() — local tools', () => {
        it('should call demo.hello and return a greeting', async () => {
            const result = await broker.call('demo.hello', { name: 'World' });
            expect(result.message).toBe('Hello, World! Event dispatched and metric recorded!');
        });

        it('should call demo.status and return health info', async () => {
            const result = await broker.call('demo.status', { name: 'Test' });
            expect(result.message).toContain('Test');
            expect(result.message).toContain('Healthy');
        });
    });

    // ─── Zod validation ─────────────────────────────────────────────────────

    describe('call() — input validation', () => {
        it('should reject invalid params with Zod error', async () => {
            await expect(
                broker.call('demo.hello', { name: 123 } as any)
            ).rejects.toThrow();
        });

        it('should reject missing required fields', async () => {
            await expect(
                broker.call('demo.hello', {} as any)
            ).rejects.toThrow();
        });
    });

    // ─── middleware ──────────────────────────────────────────────────────────

    describe('middleware chain', () => {
        it('should execute middleware in order', async () => {
            const order: string[] = [];

            broker.use(async (_ctx, next) => {
                order.push('global-1');
                const result = await next();
                order.push('global-1-after');
                return result;
            });

            await broker.call('demo.hello', { name: 'MW' });

            expect(order).toContain('global-1');
            expect(order).toContain('global-1-after');
            expect(order.indexOf('global-1')).toBeLessThan(order.indexOf('global-1-after'));
        });
    });

    // ─── events ──────────────────────────────────────────────────────────────

    describe('emit() / on()', () => {
        it('should emit and receive events', () => {
            const received: any[] = [];
            broker.on('test.event', (payload) => received.push(payload));
            broker.emit('test.event', { data: 'hello' });
            expect(received).toHaveLength(1);
            expect((received[0] as Record<string, unknown>).data).toBe('hello');
        });

        it('should support wildcard event patterns', () => {
            const received: any[] = [];
            broker.on('test.*' as any, (payload) => received.push(payload));
            broker.emit('test.foo', { a: 1 });
            broker.emit('test.bar', { b: 2 });
            expect(received).toHaveLength(2);
        });

        it('should support unsubscribe via returned function', () => {
            const received: any[] = [];
            const unsub = broker.on('unsub.test', (payload) => received.push(payload));
            broker.emit('unsub.test', { first: true });
            unsub();
            broker.emit('unsub.test', { second: true });
            expect(received).toHaveLength(1);
        });
    });

    // ─── lifecycle ───────────────────────────────────────────────────────────

    describe('start() / stop()', () => {
        it('should start and stop without errors', async () => {
            const testBroker = new ServiceBroker('lifecycle-test', app.logger);
            await testBroker.start();
            await testBroker.stop();
        });
    });
});
