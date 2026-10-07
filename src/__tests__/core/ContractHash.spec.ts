import { z } from 'zod';
import { MeshApp } from '../../core/MeshApp.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { NetworkModule } from '../../modules/NetworkModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { PlacementRegistry } from '../../core/PlacementRegistry.js';
import { WSTransport } from '../../transports/node/WSTransport.js';
import { JSONSerializer } from '../../serializers/JSONSerializer.js';
import { contractHash } from '../../core/ContractDeclaration.js';
import { defineContract, defaultPrint } from '../../interfaces/IToolContract.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import type { IServiceBroker } from '../../interfaces/IServiceBroker.js';

/**
 * Who serves a contract, with what: each node advertises a hash per contract and the software it
 * runs. On 2026-10-06 two nodes served identity.apiToken.issue from different releases, answered
 * differently, and nothing a node advertised told them apart.
 */
const issue = defineContract({
    domain: 'hashed',
    action: 'issue',
    description: 'Issues something',
    inputSchema: z.object({}),
    outputSchema: z.object({ by: z.string() }),
    filePath: 'src/__tests__/core/ContractHash.spec.ts',
    concurrency: 'on-demand',
    permissions: [],
    print: defaultPrint,
});

describe('a contract\'s hash', () => {
    it('is the same for the same contract and handler, and differs when the handler does', () => {
        const v1 = async () => ({ by: 'v1' });
        const v2 = async () => ({ by: 'v2' });

        expect(contractHash(issue, v1)).toBe(contractHash(issue, v1));
        expect(contractHash(issue, v1)).not.toBe(contractHash(issue, v2));
        expect(contractHash(issue, v1)).toMatch(/^[0-9a-f]{14}$/);
    });
});

describe('who serves a contract, with what', () => {
    let appA: MeshApp;
    let appB: MeshApp;
    const logger = new Logger(LogLevel.ERROR);
    const serializer = new JSONSerializer();

    const start = async (nodeID: string, port: number, bootstrap?: string): Promise<MeshApp> => {
        const app = new MeshApp({ nodeID, logger });
        app.use(new RegistryModule({ implementation: PlacementRegistry }));
        app.use(new NetworkModule({ port, transports: [new WSTransport(serializer, port, '127.0.0.1')], ...(bootstrap !== undefined ? { bootstrapNodes: [bootstrap] } : {}) }));
        app.use(new BrokerModule());
        await app.start();
        return app;
    };

    beforeAll(async () => {
        appA = await start('hash-node-a', 6591);
        appB = await start('hash-node-b', 6592, 'ws://127.0.0.1:6591');

        const brokerA = appA.getProvider<IServiceBroker>('broker');
        const brokerB = appB.getProvider<IServiceBroker>('broker');
        brokerA.registerContract(issue, async () => ({ by: 'old code' }));
        brokerB.registerContract(issue, async () => ({ by: 'new code' }));
        brokerA.registry.setLocalSoftware({ 'mesh-serve': 'v0.10.29' });
        brokerB.registry.setLocalSoftware({ 'mesh-serve': 'v0.10.33' });

        await new Promise((r) => setTimeout(r, 1500));
    }, 20000);

    afterAll(async () => {
        await appB?.stop();
        await appA?.stop();
    });

    it('tells the two apart, from either node', () => {
        const registryA = appA.getProvider<IServiceBroker>('broker').registry;

        const served = registryA.getNodes().flatMap((n) => n.services.flatMap((s) => {
            const tool = s.tools?.['hashed.issue'];
            return tool === undefined ? [] : [{ nodeID: n.nodeID, hash: tool.hash, software: n.software }];
        })).sort((a, b) => a.nodeID.localeCompare(b.nodeID));

        expect(served.map((s) => [s.nodeID, s.software?.['mesh-serve']])).toEqual([['hash-node-a', 'v0.10.29'], ['hash-node-b', 'v0.10.33']]);
        expect(served[0]?.hash).toMatch(/^[0-9a-f]{14}$/);
        expect(served[0]?.hash).not.toBe(served[1]?.hash);
    });
});
