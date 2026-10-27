import net from 'node:net';
import { WebSocket } from 'ws';
import { WSTransport } from '../../transports/node/WSTransport.js';
import { JSONSerializer } from '../../serializers/JSONSerializer.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';

/**
 * A frame the server refuses closes that one socket and nothing else. Inbound sockets had no
 * `error` listener, so the `error` ws emits for a refused frame was thrown: one bad frame from
 * anyone who could reach the port ended the node (review 10-26).
 */
/** Keeps what the transport warns, so a test sees the refused frame was handled, not thrown. */
class WarningsLogger extends Logger {
    readonly warnings: string[] = [];

    override warn(msg: string): void {
        this.warnings.push(msg);
    }
}

describe('WSTransport and a bad frame', () => {
    let logger = new WarningsLogger(LogLevel.ERROR);
    let transport: WSTransport | undefined;

    beforeEach(() => {
        logger = new WarningsLogger(LogLevel.ERROR);
    });

    afterEach(async () => {
        await transport?.disconnect();
        transport = undefined;
    });

    async function opens(port: number): Promise<boolean> {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        return new Promise<boolean>((resolve) => {
            ws.on('open', () => { ws.close(); resolve(true); });
            ws.on('error', () => resolve(false));
        });
    }

    /** Raw bytes after a real upgrade: what a client that is not `ws` can send. */
    async function sendRaw(port: number, frame: Buffer): Promise<void> {
        const socket = net.connect(port, '127.0.0.1');
        await new Promise<void>((resolve, reject) => {
            socket.once('error', reject);
            socket.once('connect', () => {
                socket.write([
                    'GET / HTTP/1.1', `Host: 127.0.0.1:${port}`, 'Upgrade: websocket', 'Connection: Upgrade',
                    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version: 13', '', '',
                ].join('\r\n'));
            });
            socket.once('data', () => {
                socket.write(frame);
                socket.once('close', () => resolve());
                socket.on('error', () => undefined);
            });
        });
    }

    it('a frame over maxPayload closes that socket; the node still takes connections', async () => {
        transport = new WSTransport(new JSONSerializer(), 0, '127.0.0.1', { maxPayload: 64 });
        await transport.connect({ nodeID: 'bad-frame-node', namespace: 'default', url: '', logger });
        const port = transport.getPort();

        const big = new WebSocket(`ws://127.0.0.1:${port}`);
        const closed = new Promise<number>((resolve) => big.on('close', (code) => resolve(code)));
        big.on('error', () => undefined);
        await new Promise<void>((resolve) => big.on('open', () => resolve()));
        big.send('x'.repeat(1024));

        expect(await closed).toBe(1009);
        expect(await opens(port)).toBe(true);
        expect(logger.warnings).toEqual([expect.stringContaining('Max payload size exceeded')]);
    });

    it('a frame with a reserved opcode closes that socket; the node still takes connections', async () => {
        transport = new WSTransport(new JSONSerializer(), 0, '127.0.0.1');
        await transport.connect({ nodeID: 'bad-opcode-node', namespace: 'default', url: '', logger });
        const port = transport.getPort();

        // FIN + opcode 0x3 (reserved), masked, empty payload.
        await sendRaw(port, Buffer.from([0x83, 0x80, 0x01, 0x02, 0x03, 0x04]));

        expect(await opens(port)).toBe(true);
        expect(logger.warnings).toEqual([expect.stringContaining('invalid opcode 3')]);
    });
});
