import { z } from 'zod';
import { MeshApp } from '../../core/MeshApp.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { NetworkModule } from '../../modules/NetworkModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { WSTransport } from '../../transports/node/WSTransport.js';
import { JSONSerializer } from '../../serializers/JSONSerializer.js';
import { PlacementRegistry } from '../../core/PlacementRegistry.js';
import { ServiceBroker } from '../../core/ServiceBroker.js';
import { MeshError } from '../../core/MeshError.js';
import { defineContract, defaultPrint } from '../../interfaces/IToolContract.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';

/**
 * A handler's error must mean the same thing whichever node it ran on.
 *
 * Only `message` and `stack` used to cross the wire, and the receiver rebuilt a plain `Error`. So
 * every meaningful status collapsed to 500 the moment a handler ran elsewhere: the *same* call
 * answered 404 locally and 500 remotely. Found live on a two-node cluster, where an api gateway
 * that checks `err instanceof MeshError` to pick a status saw a plain Error and fell through to
 * "Internal Server Error" for a perfectly ordinary "no such account".
 *
 * It matters more now than it did: placement makes *where* a handler runs a scheduling detail, so
 * the difference had become both routine and non-deterministic.
 */

const failContract = defineContract({
    domain: 'remoteerr',
    action: 'fail',
    description: 'Throws a MeshError with a specific code and status.',
    inputSchema: z.object({ status: z.number(), code: z.string() }),
    outputSchema: z.object({ never: z.boolean() }),
    rest: { method: 'POST', path: '/remoteerr/fail' },
    dependencies: [],
    filePath: 'src/__tests__/core/RemoteErrorStatus.spec.ts',
    permissions: [],
    concurrency: 'on-demand',
    print: defaultPrint,
});

const plainContract = defineContract({
    domain: 'remoteerr',
    action: 'plain',
    description: 'Throws an ordinary Error.',
    inputSchema: z.object({}),
    outputSchema: z.object({ never: z.boolean() }),
    rest: { method: 'POST', path: '/remoteerr/plain' },
    dependencies: [],
    filePath: 'src/__tests__/core/RemoteErrorStatus.spec.ts',
    permissions: [],
    concurrency: 'on-demand',
    print: defaultPrint,
});

declare global {
    interface IServiceToolRegistry {
        'remoteerr.fail': { params: { status: number; code: string }; returns: { never: boolean } };
        'remoteerr.plain': { params: Record<string, never>; returns: { never: boolean } };
    }
}

describe('a MeshError keeps its status across the mesh', () => {
    let serverApp: MeshApp;
    let clientApp: MeshApp;
    let serverBroker: ServiceBroker;
    let clientBroker: ServiceBroker;
    const logger = new Logger(LogLevel.ERROR);
    const serializer = new JSONSerializer();

    beforeAll(async () => {
        serverApp = new MeshApp({ nodeID: 'err-server-node', logger });
        serverApp.use(new RegistryModule({ implementation: PlacementRegistry }));
        serverApp.use(new NetworkModule({
            port: 6551,
            transports: [new WSTransport(serializer, 6551, '127.0.0.1')],
        }));
        serverApp.use(new BrokerModule());
        await serverApp.start();
        serverBroker = serverApp.getProvider<ServiceBroker>('broker');

        serverBroker.registerContract(failContract, async (params) => {
            throw new MeshError({ message: 'No such account.', code: params.code, status: params.status });
        });
        serverBroker.registerContract(plainContract, async () => {
            throw new Error('something came loose');
        });

        clientApp = new MeshApp({ nodeID: 'err-client-node', logger });
        clientApp.use(new RegistryModule({ implementation: PlacementRegistry }));
        clientApp.use(new NetworkModule({
            port: 6552,
            transports: [new WSTransport(serializer, 6552, '127.0.0.1')],
            bootstrapNodes: ['ws://127.0.0.1:6551'],
        }));
        clientApp.use(new BrokerModule());
        await clientApp.start();
        clientBroker = clientApp.getProvider<ServiceBroker>('broker');

        await new Promise((r) => { setTimeout(r, 800); });
    }, 20000);

    afterAll(async () => {
        await clientApp?.stop();
        await serverApp?.stop();
    });

    it('is a MeshError locally, with its status -- the baseline', async () => {
        const err = await serverBroker.call('remoteerr.fail', { status: 404, code: 'NOT_FOUND' }).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(MeshError);
        expect((err as MeshError).status).toBe(404);
        expect((err as MeshError).code).toBe('NOT_FOUND');
    });

    it('is still a MeshError remotely, with the same status', async () => {
        const err = await clientBroker.call('remoteerr.fail', { status: 404, code: 'NOT_FOUND' }).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(MeshError);
        expect((err as MeshError).status).toBe(404);
        expect((err as MeshError).code).toBe('NOT_FOUND');
        expect((err as Error).message).toBe('No such account.');
    });

    it('carries any status, not just 404 -- a 403 stays a 403', async () => {
        const err = await clientBroker.call('remoteerr.fail', { status: 403, code: 'FORBIDDEN' }).catch((e: unknown) => e);
        expect((err as MeshError).status).toBe(403);
        expect((err as MeshError).code).toBe('FORBIDDEN');
    });

    it('local and remote agree, which is the property that actually matters', async () => {
        const local = await serverBroker.call('remoteerr.fail', { status: 422, code: 'INVALID_INPUT' }).catch((e: unknown) => e);
        const remote = await clientBroker.call('remoteerr.fail', { status: 422, code: 'INVALID_INPUT' }).catch((e: unknown) => e);

        expect((remote as MeshError).status).toBe((local as MeshError).status);
        expect((remote as MeshError).code).toBe((local as MeshError).code);
        expect((remote as Error).message).toBe((local as Error).message);
    });

    it('leaves an ordinary Error ordinary -- it has no status to preserve', async () => {
        const err = await clientBroker.call('remoteerr.plain', {}).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(Error);
        expect(err).not.toBeInstanceOf(MeshError);
        expect((err as Error).message).toBe('something came loose');
    });

    it('keeps the far side\'s stack behind the remote boundary marker', async () => {
        const err = await clientBroker.call('remoteerr.fail', { status: 404, code: 'NOT_FOUND' }).catch((e: unknown) => e);
        expect((err as Error).stack).toContain('--- Remote Boundary ---');
    });
});
