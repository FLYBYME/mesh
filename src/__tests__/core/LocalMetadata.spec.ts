import { PlacementRegistry } from '../../core/PlacementRegistry.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import type { NodeInfo } from '../../interfaces/IMeshNetwork.js';

/**
 * A machine is given a role through the api by changing its labels while it runs. Labels used to
 * be fixed at boot (`--labels`), and peers took them from any packet on that assumption.
 */
describe('setLocalMetadata: labels changed while running', () => {
    const logger = new Logger(LogLevel.ERROR);
    let a: PlacementRegistry;
    let b: PlacementRegistry;

    beforeEach(() => {
        a = new PlacementRegistry(logger, { localNodeID: 'ns1', metadata: { role: 'dns' } });
        b = new PlacementRegistry(logger, { localNodeID: 'edge1' });
    });

    afterEach(async () => {
        await a.stop();
        await b.stop();
    });

    const snapshot = (r: PlacementRegistry, id: string): NodeInfo => {
        const n = r.getNode(id);
        if (n === undefined) throw new Error(`no node ${id}`);
        return JSON.parse(JSON.stringify({ ...n, addresses: ['ws://127.0.0.1:6590'] })) as NodeInfo;
    };

    it('changes the local labels, bumps nodeSeq and announces the change', () => {
        let announced = 0;
        a.on('local:changed', () => { announced += 1; });
        const before = a.getNode('ns1')?.nodeSeq ?? 0;
        a.setLocalMetadata({ role: 'dns,control-plane' });
        expect(a.getNode('ns1')?.metadata).toEqual({ role: 'dns,control-plane' });
        expect(a.getNode('ns1')?.nodeSeq).toBe(before + 1);
        expect(announced).toBe(1);
    });

    it('a peer takes the new labels, and a stale relay of the old ones cannot revert them', () => {
        const old = snapshot(a, 'ns1');
        b.registerNode(old, true);
        expect(b.getNode('ns1')?.metadata).toEqual({ role: 'dns' });

        a.setLocalMetadata({ role: 'dns,control-plane' });
        b.registerNode(snapshot(a, 'ns1'), true);
        expect(b.getNode('ns1')?.metadata).toEqual({ role: 'dns,control-plane' });

        b.registerNode(old, false); // PEX relaying what it held before the change
        expect(b.getNode('ns1')?.metadata).toEqual({ role: 'dns,control-plane' });
    });
});
