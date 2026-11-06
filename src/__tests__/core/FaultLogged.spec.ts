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
import { LogLevel, type ILogger } from '../../interfaces/ILogger.js';

/**
 * A handler's server fault is logged once, with its stack, on the node whose handler threw it --
 * whoever called. Only a call from another node used to be logged (4.14.13); a call from the
 * same node (another handler, the api gateway) left a line only if the caller wrote one.
 */

class Lines implements ILogger {
    public readonly errors: string[] = [];
    debug(): void {}
    info(): void {}
    warn(): void {}
    error(msg: string): void {
        this.errors.push(msg);
    }
    child(): ILogger {
        return this;
    }
    getLevel(): number {
        return LogLevel.ERROR;
    }
}

const contract = (action: string) => defineContract({
    domain: 'faultlog',
    action,
    description: `faultlog ${action}`,
    inputSchema: z.object({}),
    outputSchema: z.object({ never: z.boolean() }),
    dependencies: [],
    filePath: 'src/__tests__/core/FaultLogged.spec.ts',
    permissions: [],
    concurrency: 'on-demand',
    print: defaultPrint,
});

declare global {
    interface IServiceToolRegistry {
        'faultlog.plain': { params: Record<string, never>; returns: { never: boolean } };
        'faultlog.server': { params: Record<string, never>; returns: { never: boolean } };
        'faultlog.refused': { params: Record<string, never>; returns: { never: boolean } };
        'faultlog.outer': { params: Record<string, never>; returns: { never: boolean } };
    }
}

describe('a handler\'s server fault is logged on the node that threw it', () => {
    let serverApp: MeshApp;
    let clientApp: MeshApp;
    let server: ServiceBroker;
    let client: ServiceBroker;
    const serverLines = new Lines();
    const clientLines = new Lines();
    const serializer = new JSONSerializer();

    beforeAll(async () => {
        serverApp = new MeshApp({ nodeID: 'fault-server-node', logger: serverLines });
        serverApp.use(new RegistryModule({ implementation: PlacementRegistry }));
        serverApp.use(new NetworkModule({ port: 6561, transports: [new WSTransport(serializer, 6561, '127.0.0.1')] }));
        serverApp.use(new BrokerModule());
        await serverApp.start();
        server = serverApp.getProvider<ServiceBroker>('broker');

        server.registerContract(contract('plain'), async () => {
            throw new Error('something came loose');
        });
        server.registerContract(contract('server'), async () => {
            throw new MeshError({ message: 'store unreachable', code: 'STORE', status: 500 });
        });
        server.registerContract(contract('refused'), async () => {
            throw new MeshError({ message: 'No such account.', code: 'NOT_FOUND', status: 404 });
        });
        // A handler that passes on the fault of another on its node: still one line.
        server.registerContract(contract('outer'), async () => {
            await server.call('faultlog.plain', {});
            return { never: true };
        });

        clientApp = new MeshApp({ nodeID: 'fault-client-node', logger: clientLines });
        clientApp.use(new RegistryModule({ implementation: PlacementRegistry }));
        clientApp.use(new NetworkModule({
            port: 6562, transports: [new WSTransport(serializer, 6562, '127.0.0.1')], bootstrapNodes: ['ws://127.0.0.1:6561'],
        }));
        clientApp.use(new BrokerModule());
        await clientApp.start();
        client = clientApp.getProvider<ServiceBroker>('broker');

        await new Promise((r) => { setTimeout(r, 800); });
    }, 20000);

    afterAll(async () => {
        await clientApp?.stop();
        await serverApp?.stop();
    });

    beforeEach(() => {
        serverLines.errors.length = 0;
        clientLines.errors.length = 0;
    });

    const faults = (lines: Lines, tool: string): string[] => lines.errors.filter((l) => l.includes(`${tool}`) && l.includes('failed:'));

    it('logs a plain error from a call on its own node, with its stack', async () => {
        await expect(server.call('faultlog.plain', {})).rejects.toThrow('something came loose');

        const lines = faults(serverLines, 'faultlog.plain');
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('FaultLogged.spec.ts');
    });

    it('logs a 5xx MeshError from its own node too', async () => {
        await expect(server.call('faultlog.server', {})).rejects.toThrow('store unreachable');

        expect(faults(serverLines, 'faultlog.server')).toHaveLength(1);
    });

    it('leaves a refusal (4xx) to its caller', async () => {
        await expect(server.call('faultlog.refused', {})).rejects.toThrow('No such account.');
        await expect(client.call('faultlog.refused', {})).rejects.toThrow('No such account.');

        expect(serverLines.errors).toEqual([]);
        expect(clientLines.errors).toEqual([]);
    });

    it('logs a fault passed on by another handler once, where it was thrown', async () => {
        await expect(server.call('faultlog.outer', {})).rejects.toThrow('something came loose');

        expect(faults(serverLines, 'faultlog.')).toHaveLength(1);
        expect(faults(serverLines, 'faultlog.plain')).toHaveLength(1);
    });

    it('logs a call from another node once, on the node that threw it, and not on the caller', async () => {
        await expect(client.call('faultlog.plain', {})).rejects.toThrow('something came loose');
        await expect(client.call('faultlog.server', {})).rejects.toThrow('store unreachable');

        expect(faults(serverLines, 'faultlog.plain')).toHaveLength(1);
        expect(faults(serverLines, 'faultlog.plain')[0]).toContain('(called from fault-client-node)');
        expect(faults(serverLines, 'faultlog.server')).toHaveLength(1);
        expect(clientLines.errors).toEqual([]);
    });
});
