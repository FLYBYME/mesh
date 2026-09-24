import { MeshOrchestrator, BOOTSTRAP_SUPERVISION_INTERVAL_MS } from '../../core/MeshOrchestrator.js';
import { PlacementRegistry } from '../../core/PlacementRegistry.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import type { IMeshNetworkNode } from '../../interfaces/IMeshNetwork.js';

/**
 * Bootstrap peers used to be dialed once, at start. A bootstrap peer lost later came back only if
 * the transport's own reconnect loop survived (it gave up after ten tries across all peers) or if
 * another peer's PEX happened to mention it. Found live: a cluster left as a star around one node,
 * or with nodes that had no links at all, until they were restarted by hand.
 */
describe('bootstrap peers are supervised, not dialed once', () => {
    const logger = new Logger(LogLevel.ERROR);
    const peerUrl = 'ws://10.42.0.3:5005';

    let registry: PlacementRegistry;
    let orchestrator: MeshOrchestrator;
    let dials: string[];
    let needsDial: boolean | undefined;

    beforeEach(() => {
        jest.useFakeTimers();
        registry = new PlacementRegistry(logger, { localNodeID: 'local' });
        dials = [];
        needsDial = true;

        const node: IMeshNetworkNode = {
            nodeID: 'local',
            namespace: 'default',
            logger,
            registry,
            send: async (): Promise<void> => undefined,
            publish: async (): Promise<void> => undefined,
            connectToPeer: async (_nodeID: string, url: string): Promise<void> => { dials.push(url); },
            isPeerConnected: (): boolean => false,
            needsDial: (): boolean | undefined => needsDial,
        };
        orchestrator = new MeshOrchestrator(node, { bootstrapNodes: [peerUrl] });
    });

    afterEach(async () => {
        await orchestrator.stop();
        await registry.stop();
        jest.useRealTimers();
    });

    it('redials a bootstrap peer that is not connected, without any PEX', async () => {
        await orchestrator.start();
        expect(dials).toEqual([peerUrl]);

        jest.advanceTimersByTime(BOOTSTRAP_SUPERVISION_INTERVAL_MS);
        expect(dials).toEqual([peerUrl, peerUrl]);
    });

    it('leaves a bootstrap peer alone while the transport says it needs no dial', async () => {
        await orchestrator.start();
        needsDial = false;

        jest.advanceTimersByTime(BOOTSTRAP_SUPERVISION_INTERVAL_MS * 3);
        expect(dials).toEqual([peerUrl]);
    });

    it('does not redial through a transport that cannot tell whether a dial is needed', async () => {
        await orchestrator.start();
        needsDial = undefined;

        jest.advanceTimersByTime(BOOTSTRAP_SUPERVISION_INTERVAL_MS * 3);
        expect(dials).toEqual([peerUrl]);
    });
});
