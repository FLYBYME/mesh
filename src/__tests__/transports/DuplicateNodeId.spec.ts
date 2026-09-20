import { WSTransport } from '../../transports/node/WSTransport.js';
import { JSONSerializer } from '../../serializers/JSONSerializer.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';

/**
 * Two live processes claiming one nodeID.
 *
 * `peers` is keyed by nodeID and `send()` resolves exactly one socket per key, so only one of two
 * claimants can ever be reachable. The old behaviour kept the incumbent and left the newcomer
 * connected, accepted, and deaf -- it never got a `peer:connect`, so nothing was ever sent to it,
 * and it failed a while later as "Timeout: Only 1/2 nodes found": an error about node counts that
 * named neither the collision nor the node it collided with.
 *
 * Worse, the newcomer still recorded the id it had not been given, so its *disconnect* deleted the
 * incumbent's entry -- a short-lived duplicate silently broke a healthy peer, leaving its socket
 * open and unreachable.
 *
 * Found live rather than reasoned about: `mesh-serve bootstrap` hardcodes `nodeID: 'bootstrap-1'`,
 * so one wizard interrupted mid-form made every later bootstrap against that node fail, with an
 * error pointing at node counts, for as long as the first process lived.
 */
describe('a second connection claiming a nodeID that is already connected', () => {
    const logger = new Logger(LogLevel.ERROR);
    const serializer = new JSONSerializer();

    let server: WSTransport;
    let first: WSTransport;
    let second: WSTransport;

    const settle = async (ms = 300): Promise<void> => {
        await new Promise((resolve) => setTimeout(resolve, ms));
    };

    /**
     * A dialling transport is anonymous until it says something: the server learns a peer's nodeID
     * from the `senderNodeID` on its first inbound packet (`handleIncomingMessage`'s `onIdentify`),
     * not from the socket itself. A real node identifies itself constantly through presence; a bare
     * transport has to be asked to, which is what this does.
     */
    const announce = async (transport: WSTransport, to: string): Promise<void> => {
        await transport.send(to, {
            id: `hello_${Math.random().toString(36).slice(2)}`,
            topic: 'test.hello',
            type: 'EVENT',
            senderNodeID: 'unused -- send() overwrites this with the transport\'s own id',
            timestamp: Date.now(),
            data: {},
        });
    };

    const join = async (transport: WSTransport, port: number): Promise<void> => {
        await transport.connectToPeer('server-node', `ws://127.0.0.1:${port}`);
        await announce(transport, 'server-node');
        await settle();
    };

    beforeEach(async () => {
        server = new WSTransport(serializer, 0, '127.0.0.1');
        await server.connect({ nodeID: 'server-node', namespace: 'default', url: '', logger });
    });

    afterEach(async () => {
        await second?.disconnect();
        await first?.disconnect();
        await server.disconnect();
    });

    it('refuses the newcomer instead of accepting it silently, and keeps the incumbent reachable', async () => {
        const port = server.getPort();
        const connected: string[] = [];
        server.on('peer:connect', (id: unknown) => connected.push(String(id)));

        first = new WSTransport(serializer, 0, '127.0.0.1');
        await first.connect({ nodeID: 'claimant', namespace: 'default', url: '', logger });
        await join(first, port);

        // The incumbent is the one the server can actually reach.
        expect(connected).toContain('claimant');
        expect(server.isPeerConnected('claimant')).toBe(true);

        second = new WSTransport(serializer, 0, '127.0.0.1');
        await second.connect({ nodeID: 'claimant', namespace: 'default', url: '', logger });
        await join(second, port);

        // The newcomer is refused, not quietly kept as a second socket under the same key: the
        // server announced exactly one connection for this id, the first one.
        expect(connected.filter((id) => id === 'claimant')).toHaveLength(1);

        // And the refusal does not disturb the incumbent, which is still the reachable socket.
        expect(server.isPeerConnected('claimant')).toBe(true);
    });

    it('does not let the refused newcomer take the incumbent down when it disconnects', async () => {
        const port = server.getPort();

        first = new WSTransport(serializer, 0, '127.0.0.1');
        await first.connect({ nodeID: 'claimant', namespace: 'default', url: '', logger });
        await join(first, port);

        second = new WSTransport(serializer, 0, '127.0.0.1');
        await second.connect({ nodeID: 'claimant', namespace: 'default', url: '', logger });
        await join(second, port);

        // The bug this is really about: the refused socket closing used to run
        // `peers.delete('claimant')`, evicting a connection it never owned.
        await second.disconnect();
        await settle();

        expect(server.isPeerConnected('claimant')).toBe(true);
    });

    it('lets the id be claimed again once the incumbent is gone', async () => {
        const port = server.getPort();

        first = new WSTransport(serializer, 0, '127.0.0.1');
        await first.connect({ nodeID: 'claimant', namespace: 'default', url: '', logger });
        await join(first, port);

        await first.disconnect();
        await settle();
        expect(server.isPeerConnected('claimant')).toBe(false);

        // Refusing a duplicate must not turn the id into a permanent tombstone -- restarting the
        // process that holds it is the normal fix, and it has to work.
        second = new WSTransport(serializer, 0, '127.0.0.1');
        await second.connect({ nodeID: 'claimant', namespace: 'default', url: '', logger });
        await join(second, port);

        expect(server.isPeerConnected('claimant')).toBe(true);
    });
});
