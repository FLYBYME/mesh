import { MeshApp } from '../../core/MeshApp.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { NetworkModule } from '../../modules/NetworkModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { WSTransport } from '../../transports/node/WSTransport.js';
import { JSONSerializer } from '../../serializers/JSONSerializer.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import type { IMeshNetwork } from '../../interfaces/IMeshNetwork.js';
import type { IServiceBroker } from '../../interfaces/IServiceBroker.js';
import type { MeshLinkChanged } from '../../core/MeshEvents.js';
import { eventScope } from '../../core/EventScope.js';
import { MeshMetrics } from '../../metrics/MeshMetrics.js';

/**
 * A node's links, from the platform rather than from `ss` on the box: what each node is directly
 * linked to right now (`peerLinks`), and every link coming up or going down as `mesh.link.changed`.
 * Found needed operating a four-node cluster, where the only way to see a broken mesh was SSHing
 * into every node.
 */
describe('mesh link status', () => {
    const logger = new Logger(LogLevel.ERROR);
    const serializer = new JSONSerializer();
    let appA: MeshApp;
    let appB: MeshApp;
    const seenOnA: MeshLinkChanged[] = [];
    // A's own counters, apart from the process-wide ones every other node here records into.
    const metricsA = new MeshMetrics();

    const start = async (nodeID: string, port: number, bootstrap?: string, metrics?: MeshMetrics): Promise<MeshApp> => {
        const app = new MeshApp({ nodeID, logger });
        const transport = new WSTransport(serializer, port, '127.0.0.1');
        if (metrics !== undefined) transport.metrics = metrics;
        app.use(new RegistryModule());
        app.use(new NetworkModule({
            port,
            transports: [transport],
            ...(bootstrap !== undefined ? { bootstrapNodes: [bootstrap] } : {}),
        }));
        app.use(new BrokerModule());
        await app.start();
        return app;
    };

    const settle = (ms = 400): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

    beforeAll(async () => {
        // 657x: every lower 65x1/65x2 pair is taken by another spec, and jest runs suites in parallel.
        appA = await start('links-node-a', 6571, undefined, metricsA);
        appA.getProvider<IServiceBroker>('broker').on('mesh.link.changed', (change) => { seenOnA.push(change); });
        appB = await start('links-node-b', 6572, 'ws://127.0.0.1:6571');
        await settle(800);
    });

    afterAll(async () => {
        await appA?.stop();
    });

    it('lists the links each end holds, and which end dialed', () => {
        const linksA = appA.getProvider<IMeshNetwork>('network').peerLinks?.() ?? [];
        const linksB = appB.getProvider<IMeshNetwork>('network').peerLinks?.() ?? [];

        expect(linksA.map((l) => l.nodeID)).toEqual(['links-node-b']);
        expect(linksB.map((l) => l.nodeID)).toEqual(['links-node-a']);
        expect(linksA[0]?.dialedBy).toBe('remote');
        expect(linksB[0]?.dialedBy).toBe('self');
    });

    it('reports a link coming up, and going down when the peer leaves', async () => {
        expect(seenOnA).toContainEqual(expect.objectContaining({ nodeID: 'links-node-a', peer: 'links-node-b', state: 'up' }));

        await appB.stop();
        await settle();

        expect(seenOnA).toContainEqual(expect.objectContaining({ nodeID: 'links-node-a', peer: 'links-node-b', state: 'down' }));
        expect(appA.getProvider<IMeshNetwork>('network').peerLinks?.()).toEqual([]);
        // And counts it: a link that keeps going down and up is a reconnect loop (edge1, 2026-10-06).
        expect(metricsA.linkChanges.get(['links-node-b', 'up'])).toBe(1);
        expect(metricsA.linkChanges.get(['links-node-b', 'down'])).toBe(1);
    });

    it('is delivered to everyone who may see it -- the fleet belongs to no tenant', () => {
        expect(eventScope('mesh.link.changed')).toBe('global');
    });
});
