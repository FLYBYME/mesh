import net from 'node:net';
import { WSTransport } from '../../transports/node/WSTransport.js';
import { JSONSerializer } from '../../serializers/JSONSerializer.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';

/**
 * Peer links that break and never re-form.
 *
 * Found live on a four-node cluster where every node dials every other: after any restart the mesh
 * lost links and kept them lost -- once a star around the node restarted last, once two nodes with
 * no links at all -- until nodes were restarted by hand. Every call that crossed a missing link
 * failed ("no domain repo is mounted anywhere"). Four transport faults, each covered here:
 *
 * - Two nodes dialing each other at once each refused the other's socket as a duplicate nodeID
 *   (4409), which the dialer treats as permanent -- leaving the pair with no link.
 * - A restarted node was refused by the stale socket its peer still held for its old process, and
 *   never retried.
 * - A dialer that opened a second socket to a connected peer filed it over the live one unchecked;
 *   when the peer refused it, closing it dropped the working link too.
 * - Reconnects shared one counter across all peers and stopped for good after ten.
 */
describe('peer links re-form after collisions and restarts', () => {
    const logger = new Logger(LogLevel.ERROR);
    const serializer = new JSONSerializer();
    const open: WSTransport[] = [];
    const proxies: FreezableProxy[] = [];

    const settle = async (ms = 300): Promise<void> => {
        await new Promise((resolve) => setTimeout(resolve, ms));
    };

    const start = async (nodeID: string, pingTimeoutMs = 5000): Promise<WSTransport> => {
        // A long ping interval, so the regular heartbeat cannot be what cleans anything up: every
        // recovery below has to come from the collision handling itself.
        const transport = new WSTransport(serializer, 0, '127.0.0.1', { pingIntervalMs: 60_000, pingTimeoutMs });
        await transport.connect({ nodeID, namespace: 'default', url: '', logger });
        open.push(transport);
        return transport;
    };

    const url = (transport: WSTransport): string => `ws://127.0.0.1:${transport.getPort()}`;

    /** Resolves with the next `test.hello` payload `transport` receives. */
    const nextHello = (transport: WSTransport): Promise<unknown> =>
        new Promise((resolve) => transport.addHandler('test.hello', resolve));

    const hello = async (from: WSTransport, to: string, data: string): Promise<void> => {
        await from.send(to, {
            id: `hello_${Math.random().toString(36).slice(2)}`,
            topic: 'test.hello',
            type: 'EVENT',
            senderNodeID: 'overwritten by send()',
            targetNodeID: to,
            timestamp: Date.now(),
            data,
        });
    };

    /** A message from `from` reaches `to` over their link, within `ms`. */
    const delivers = async (from: WSTransport, to: WSTransport, toId: string, ms = 1000): Promise<boolean> => {
        const received = nextHello(to);
        await hello(from, toId, 'ping');
        const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), ms));
        return (await Promise.race([received, timeout])) !== 'timeout';
    };

    afterEach(async () => {
        for (const transport of open.splice(0)) await transport.disconnect();
        for (const proxy of proxies.splice(0)) await proxy.close();
    });

    it('keeps exactly one link when two nodes dial each other at the same moment', async () => {
        const a = await start('node-a');
        const b = await start('node-b');
        const dropped: string[] = [];
        a.on('peer:disconnect', (id: unknown) => dropped.push(`a lost ${String(id)}`));
        b.on('peer:disconnect', (id: unknown) => dropped.push(`b lost ${String(id)}`));

        await Promise.all([a.connectToPeer('node-b', url(b)), b.connectToPeer('node-a', url(a))]);
        await hello(a, 'node-b', 'from a');
        await hello(b, 'node-a', 'from b');
        await settle();

        expect(a.isPeerConnected('node-b')).toBe(true);
        expect(b.isPeerConnected('node-a')).toBe(true);
        expect(dropped).toEqual([]);
        expect(await delivers(a, b, 'node-b')).toBe(true);
        expect(await delivers(b, a, 'node-a')).toBe(true);
    });

    it('accepts a restarted peer whose old socket is still held, once that socket fails a probe', async () => {
        const server = await start('server-node', 300);
        const proxy = await FreezableProxy.to(server.getPort());
        proxies.push(proxy);

        // The first process reaches the server through a link that can go silent without closing --
        // what a crashed host or a dropped route looks like from the other end.
        const oldProcess = await start('restarting');
        await oldProcess.connectToPeer('server-node', `ws://127.0.0.1:${proxy.port}`);
        await hello(oldProcess, 'server-node', 'first life');
        await settle();
        expect(server.isPeerConnected('restarting')).toBe(true);

        proxy.freeze();
        await oldProcess.disconnect();

        // The new process, same nodeID, while the server still holds the old socket.
        const newProcess = await start('restarting');
        await newProcess.connectToPeer('server-node', url(server));
        await settle(800);

        expect(server.isPeerConnected('restarting')).toBe(true);
        expect(newProcess.isPeerConnected('server-node')).toBe(true);
        expect(await delivers(server, newProcess, 'restarting')).toBe(true);
    });

    it('still refuses a second live process with the same nodeID', async () => {
        const server = await start('server-node', 300);
        const first = await start('claimant');
        await first.connectToPeer('server-node', url(server));
        await settle();

        const second = await start('claimant');
        await second.connectToPeer('server-node', url(server));
        await settle(800);

        expect(second.isPeerConnected('server-node')).toBe(false);
        expect(await delivers(server, first, 'claimant')).toBe(true);
    });

    it('does not drop a working link when a second dial to the same peer is closed', async () => {
        const a = await start('node-a');
        const b = await start('node-b');
        const proxy = await FreezableProxy.to(b.getPort());
        proxies.push(proxy);
        const dropped: string[] = [];
        a.on('peer:disconnect', (id: unknown) => dropped.push(`a lost ${String(id)}`));
        b.on('peer:disconnect', (id: unknown) => dropped.push(`b lost ${String(id)}`));

        await a.connectToPeer('node-b', url(b));
        await hello(a, 'node-b', 'first');
        await settle();

        // The same peer again under another address -- as a bootstrap dial and a PEX dial can.
        await a.connectToPeer('bootstrap_x', `ws://127.0.0.1:${proxy.port}`);
        await hello(a, 'node-b', 'second');
        await settle();

        expect(dropped).toEqual([]);
        expect(a.isPeerConnected('node-b')).toBe(true);
        expect(b.isPeerConnected('node-a')).toBe(true);
        expect(await delivers(a, b, 'node-b')).toBe(true);
        expect(await delivers(b, a, 'node-a')).toBe(true);
    });

    it('knows which URLs need a dial, so supervision cannot pile dials up', async () => {
        const a = await start('node-a');
        const b = await start('node-b');

        expect(a.needsDial(url(b))).toBe(true);
        await a.connectToPeer('bootstrap_b', url(b));
        await settle();
        expect(a.needsDial(url(b))).toBe(false);

        // Its own address, as a bootstrap list naming every node includes.
        await a.connectToPeer('bootstrap_self', url(a));
        await settle();
        expect(a.needsDial(url(a))).toBe(false);
        expect(a.isPeerConnected('node-a')).toBe(false);
    });
});

/**
 * A TCP relay that can be frozen: after `freeze()` it forwards nothing in either direction and closes
 * nothing, so each end is left holding an open socket to a peer that has gone silent.
 */
class FreezableProxy {
    private frozen = false;
    private readonly sockets = new Set<net.Socket>();

    private constructor(private readonly server: net.Server, public readonly port: number) {}

    static async to(targetPort: number): Promise<FreezableProxy> {
        const holder: { proxy?: FreezableProxy } = {};
        const server = net.createServer((client) => {
            const upstream = net.connect(targetPort, '127.0.0.1');
            holder.proxy?.track(client, upstream);
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (address === null || typeof address === 'string') throw new Error('proxy has no port');
        const proxy = new FreezableProxy(server, address.port);
        holder.proxy = proxy;
        return proxy;
    }

    private track(client: net.Socket, upstream: net.Socket): void {
        this.sockets.add(client);
        this.sockets.add(upstream);
        const relay = (from: net.Socket, to: net.Socket): void => {
            from.on('data', (chunk) => { if (!this.frozen) to.write(chunk); });
            from.on('close', () => { if (!this.frozen) to.destroy(); });
            from.on('error', () => undefined);
        };
        relay(client, upstream);
        relay(upstream, client);
    }

    freeze(): void {
        this.frozen = true;
    }

    async close(): Promise<void> {
        for (const socket of this.sockets) socket.destroy();
        await new Promise<void>((resolve) => this.server.close(() => resolve()));
    }
}
