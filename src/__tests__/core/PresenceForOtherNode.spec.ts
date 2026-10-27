import { MeshApp } from '../../core/MeshApp.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { NetworkModule } from '../../modules/NetworkModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { WSTransport } from '../../transports/node/WSTransport.js';
import { JSONSerializer } from '../../serializers/JSONSerializer.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import type { IMeshNetwork, NodeInfo } from '../../interfaces/IMeshNetwork.js';
import type { IServiceRegistry } from '../../interfaces/IServiceRegistry.js';

/**
 * Presence is a node speaking for itself, and outranks any relayed record of it. A peer that sent
 * presence naming another node rewrote that node's record -- its addresses, services, metadata --
 * on everyone it reached (review 10-26). Presence now counts only from the node it names.
 */
describe('presence for another node', () => {
    const logger = new Logger(LogLevel.ERROR);
    const serializer = new JSONSerializer();
    let appA: MeshApp;
    let appB: MeshApp;

    const start = async (nodeID: string, port: number, bootstrap?: string): Promise<MeshApp> => {
        const app = new MeshApp({ nodeID, logger });
        app.use(new RegistryModule());
        app.use(new NetworkModule({
            port,
            transports: [new WSTransport(serializer, port, '127.0.0.1')],
            ...(bootstrap !== undefined ? { bootstrapNodes: [bootstrap] } : {}),
        }));
        app.use(new BrokerModule());
        await app.start();
        return app;
    };

    const settle = (ms = 400): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

    const claimed = (nodeID: string): NodeInfo => ({
        nodeID,
        type: 'node',
        namespace: 'default',
        addresses: ['ws://203.0.113.66:6005'],
        available: true,
        timestamp: Date.now(),
        nodeSeq: 9_999,
        bootedAt: Date.now(),
        hostname: 'forged',
        services: [],
        trustLevel: 'internal',
        metadata: { forged: 'yes' },
        capabilities: { transports: ['ws'], features: [] },
        pid: 1,
    });

    beforeAll(async () => {
        appA = await start('presence-a', 17621);
        appB = await start('presence-b', 17622, 'ws://127.0.0.1:17621');
        await settle(800);
    });

    afterAll(async () => {
        await appB.stop();
        await appA.stop();
    });

    it('is ignored; the sender\'s own presence still counts', async () => {
        const registryA = appA.getProvider<IServiceRegistry>('registry');
        expect(registryA.getNode('presence-b')).toBeDefined();

        await appB.getProvider<IMeshNetwork>('network').publish('$node.presence', { node: claimed('presence-victim') });
        await settle();

        expect(registryA.getNode('presence-victim')).toBeUndefined();
        expect(registryA.getNode('presence-b')?.metadata?.forged).toBeUndefined();
    });
});
