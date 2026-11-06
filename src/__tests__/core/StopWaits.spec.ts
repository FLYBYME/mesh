import { createServer, type Server } from 'node:net';
import { z } from 'zod';
import { MeshApp } from '../../core/MeshApp.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { PlacementRegistry } from '../../core/PlacementRegistry.js';
import { closesOf, onStop } from '../../core/StopWork.js';
import { defineContract, defaultPrint } from '../../interfaces/IToolContract.js';
import type { IServiceBroker } from '../../interfaces/IServiceBroker.js';
import type { IServiceContext } from '../../interfaces/IServiceContext.js';

/**
 * A stop waits for what it stops (StopWork.ts). 11-05: a part reloaded onto its own old copy's port
 * -- the old one asked to close, not yet closed -- got EADDRINUSE, and its node went down.
 */
const common = {
    inputSchema: z.object({ port: z.number() }),
    outputSchema: z.object({ port: z.number() }),
    filePath: 'src/__tests__/core/StopWaits.spec.ts',
    permissions: [],
    print: defaultPrint,
};
const listen = defineContract({ ...common, domain: 'stopwaits', action: 'listen', description: 'Holds a port until stopped', concurrency: 'long-running' });

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A port, listening; resolves with what was bound, rejects with EADDRINUSE and the like. */
function bind(port: number): Promise<Server> {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve(server));
    });
}

function portOf(server: Server): number {
    const address = server.address();
    return typeof address === 'object' && address !== null ? address.port : 0;
}

/** A close that takes a while, as a real one does (a server's sessions, a last report). */
async function slowClose(server: Server, ms: number): Promise<void> {
    await wait(ms);
    await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('a stop waits for its closes', () => {
    let app: MeshApp;
    let broker: IServiceBroker;

    beforeEach(async () => {
        app = new MeshApp({ nodeID: 'stopwaits-node', namespace: 'test', logger: new Logger(LogLevel.ERROR) });
        app.use(new RegistryModule({ preferLocal: true, implementation: PlacementRegistry }));
        app.use(new BrokerModule());
        await app.start();
        broker = app.getProvider<IServiceBroker>('broker');
    });

    afterEach(async () => {
        await app.stop();
    });

    it('unregisterContract resolves once the port is let go: the next copy binds it', async () => {
        const handler = async (input: { port: number }, ctx: IServiceContext) => {
            const server = await bind(input.port);
            onStop(ctx.signal, () => slowClose(server, 100));

            return { port: portOf(server) };
        };
        broker.registerContract(listen, handler);
        const { port } = await broker.call('stopwaits.listen', { port: 0 });

        await broker.unregisterContract('stopwaits.listen');

        const next = await bind(port);
        expect(portOf(next)).toBe(port);
        await new Promise<void>((resolve) => next.close(() => resolve()));
    });

    it('without waiting, the same reload meets its own old copy (what onStop is for)', async () => {
        const handler = async (input: { port: number }, ctx: IServiceContext) => {
            const server = await bind(input.port);
            onStop(ctx.signal, () => slowClose(server, 100));

            return { port: portOf(server) };
        };
        broker.registerContract(listen, handler);
        const { port } = await broker.call('stopwaits.listen', { port: 0 });

        const closing = broker.unregisterContract('stopwaits.listen');

        await expect(bind(port)).rejects.toThrow(/EADDRINUSE/);
        await closing;
    });

    it('unregisterOwner waits for every close the owner\'s contracts handed over', async () => {
        const closed: string[] = [];
        const handler = async (input: { port: number }, ctx: IServiceContext) => {
            onStop(ctx.signal, async () => {
                await wait(50);
                closed.push('first');
            });
            onStop(ctx.signal, async () => {
                await wait(80);
                closed.push('second');
            });

            return input;
        };
        broker.withOwner('part:stopwaits', () => broker.registerContract(listen, handler));
        await broker.call('stopwaits.listen', { port: 1 });

        await broker.unregisterOwner('part:stopwaits');

        expect(closed.sort()).toEqual(['first', 'second']);
    });

    it('a close that fails is reported, never thrown into the stop', async () => {
        const handler = async (input: { port: number }, ctx: IServiceContext) => {
            onStop(ctx.signal, () => {
                throw new Error('could not close');
            });

            return input;
        };
        broker.registerContract(listen, handler);
        await broker.call('stopwaits.listen', { port: 1 });

        await expect(broker.unregisterContract('stopwaits.listen')).resolves.toBeUndefined();
    });

    it('broker.stop waits for them too', async () => {
        let closed = false;
        const handler = async (input: { port: number }, ctx: IServiceContext) => {
            onStop(ctx.signal, async () => {
                await wait(50);
                closed = true;
            });

            return input;
        };
        broker.registerContract(listen, handler);
        await broker.call('stopwaits.listen', { port: 1 });

        await broker.stop();

        expect(closed).toBe(true);
    });
});

describe('onStop and closesOf', () => {
    it('a signal already aborted closes at once', async () => {
        const abort = new AbortController();
        abort.abort();
        let closed = false;

        onStop(abort.signal, () => {
            closed = true;
        });

        expect(await closesOf(abort.signal)).toEqual({ closed: 1, failed: [], stillClosing: 0 });
        expect(closed).toBe(true);
    });

    it('a close that never finishes is given up on after the wait, and counted', async () => {
        const abort = new AbortController();
        onStop(abort.signal, () => new Promise<void>(() => undefined));
        onStop(abort.signal, () => undefined);
        abort.abort();

        const outcome = await closesOf(abort.signal, 50);

        expect(outcome).toEqual({ closed: 1, failed: [], stillClosing: 1 });
    });

    it('nothing handed over: nothing to wait for', async () => {
        const abort = new AbortController();
        abort.abort();

        expect(await closesOf(abort.signal)).toEqual({ closed: 0, failed: [], stillClosing: 0 });
    });

    it('a failure is returned, not thrown', async () => {
        const abort = new AbortController();
        onStop(abort.signal, async () => {
            throw new Error('no');
        });
        abort.abort();

        const outcome = await closesOf(abort.signal);

        expect(outcome.closed).toBe(0);
        expect(outcome.failed).toHaveLength(1);
    });
});
