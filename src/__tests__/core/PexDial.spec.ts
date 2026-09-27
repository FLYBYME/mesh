import { MeshApp } from '../../core/MeshApp.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { NetworkModule } from '../../modules/NetworkModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { WSTransport } from '../../transports/node/WSTransport.js';
import { JSONSerializer } from '../../serializers/JSONSerializer.js';
import { PlacementRegistry } from '../../core/PlacementRegistry.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import type { IMeshNetworkNode } from '../../interfaces/IMeshNetwork.js';

/**
 * Two nodes that both start from the same hub must end up connected to each other, not only to
 * the hub. Found live: a pod started from the four hosts stayed connected to those four only and
 * pruned every peer it had merely heard about via PEX. Laid out like the cluster: every node on its
 * own address, all on the same port, each advertising its address (127.0.0.0/8 is all loopback).
 */
describe('peers learned via PEX are dialed', () => {
    const logger = new Logger(LogLevel.ERROR);
    const serializer = new JSONSerializer();
    const port = 6531;
    const apps: MeshApp[] = [];

    const startNode = async (nodeID: string, host: string, bootstrap: string[]): Promise<MeshApp> => {
        const app = new MeshApp({ nodeID, logger });
        app.use(new RegistryModule({ implementation: PlacementRegistry }));
        app.use(new NetworkModule({
            transports: [new WSTransport(serializer, port, host)],
            advertiseHost: host,
            ...(bootstrap.length > 0 ? { bootstrapNodes: bootstrap } : {}),
        }));
        app.use(new BrokerModule());
        await app.start();
        apps.push(app);
        return app;
    };

    const connected = (app: MeshApp, peer: string): boolean => {
        const network = app.getProvider<IMeshNetworkNode>('network');
        return network.isPeerConnected?.(peer) ?? false;
    };

    const waitFor = async (check: () => boolean, ms: number): Promise<boolean> => {
        const until = Date.now() + ms;
        while (Date.now() < until) {
            if (check()) return true;
            await new Promise((r) => setTimeout(r, 100));
        }
        return check();
    };

    afterAll(async () => {
        for (const app of apps.reverse()) await app.stop();
    });

    it('two spokes of one hub connect to each other', async () => {
        await startNode('pex-hub', '127.0.0.11', []);
        const b = await startNode('pex-b', '127.0.0.12', [`ws://127.0.0.11:${port}`]);
        const c = await startNode('pex-c', '127.0.0.13', [`ws://127.0.0.11:${port}`]);

        // The cause: a node given only a transport and an advertiseHost advertised no address.
        const own = b.getProvider<PlacementRegistry>('registry').getNode('pex-b');
        expect(own?.addresses).toEqual([`ws://127.0.0.12:${port}`]);

        expect(await waitFor(() => connected(b, 'pex-c') && connected(c, 'pex-b'), 15000)).toBe(true);
    }, 20000);
});
