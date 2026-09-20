import { RegistryModule } from '../../modules/RegistryModule.js';
import { PRESENCE_INTERVAL_MS } from '../../core/MeshOrchestrator.js';

/**
 * A `ttl` below the presence interval produces a cluster that spends most of its time declaring
 * its own peers dead, and looks completely healthy on a single node.
 *
 * That is not hypothetical: `mesh-serve start` shipped `ttl: 5000` against a 15s presence. Every
 * single-node test passed, and the first two-node run had each node marking the other offline
 * within seven seconds of connecting, pruning it, rediscovering it, and repeating -- with no error
 * anywhere, just calls that failed with "no node advertises this domain".
 */
describe('RegistryModule ttl', () => {
    it('refuses a ttl below the presence interval', () => {
        expect(() => new RegistryModule({ ttl: 5000 })).toThrow(/below the presence interval/);
    });

    it('names the interval and a usable value, so the message is actionable', () => {
        expect(() => new RegistryModule({ ttl: 5000 })).toThrow(
            new RegExp(`${PRESENCE_INTERVAL_MS}ms.*at least ${PRESENCE_INTERVAL_MS * 2}ms`, 's'),
        );
    });

    it('accepts exactly the presence interval, and anything above it', () => {
        expect(() => new RegistryModule({ ttl: PRESENCE_INTERVAL_MS })).not.toThrow();
        expect(() => new RegistryModule({ ttl: 30000 })).not.toThrow();
    });

    it('accepts no ttl at all -- the default is already correct', () => {
        expect(() => new RegistryModule()).not.toThrow();
        expect(() => new RegistryModule({ preferLocal: true })).not.toThrow();
    });
});
