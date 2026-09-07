import { WSTransport } from '../../transports/node/WSTransport.js';
import { JSONSerializer } from '../../serializers/JSONSerializer.js';
import { MeshApp } from '../../core/MeshApp.js';
import { NetworkModule } from '../../modules/NetworkModule.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { WebSocket } from 'ws';
import os from 'node:os';

describe('WSTransport Host Binding', () => {
    const logger = new Logger(LogLevel.ERROR);
    const serializer = new JSONSerializer();

    function getNonLoopbackIPv4(): string | undefined {
        const interfaces = os.networkInterfaces();
        for (const ifaces of Object.values(interfaces)) {
            for (const iface of ifaces || []) {
                if (!iface.internal && iface.family === 'IPv4') {
                    return iface.address;
                }
            }
        }
        return undefined;
    }

    const nonLoopbackIp = getNonLoopbackIPv4();

    describe('Standalone WSTransport', () => {
        let transport: WSTransport | undefined;

        afterEach(async () => {
            if (transport) {
                await transport.disconnect();
                transport = undefined;
            }
        });

        it('a transport told 127.0.0.1 binds loopback and is not reachable on another interface', async () => {
            if (!nonLoopbackIp) {
                return;
            }

            transport = new WSTransport(serializer, 0, '127.0.0.1');
            await transport.connect({ nodeID: 'bind-test-node', namespace: 'default', url: '', logger });
            const port = transport.getPort();
            expect(transport.getHost()).toBe('127.0.0.1');

            // 1. Dial loopback -- must succeed
            const wsLoopback = new WebSocket(`ws://127.0.0.1:${port}`);
            await new Promise<void>((resolve, reject) => {
                wsLoopback.on('open', () => {
                    wsLoopback.close();
                    resolve();
                });
                wsLoopback.on('error', reject);
            });

            // 2. Dial non-loopback IP -- must fail to connect (ECONNREFUSED)
            const wsNonLoopback = new WebSocket(`ws://${nonLoopbackIp}:${port}`);
            const error = await new Promise<Error>((resolve) => {
                wsNonLoopback.on('open', () => {
                    wsNonLoopback.close();
                    resolve(new Error('Unexpectedly connected to non-loopback interface!'));
                });
                wsNonLoopback.on('error', (err) => resolve(err));
            });

            expect((error as any).code).toBe('ECONNREFUSED');
        });
    });

    describe('MeshApp & NetworkModule with UnifiedServer', () => {
        let app: MeshApp | undefined;

        afterEach(async () => {
            if (app) {
                await app.stop();
                app = undefined;
            }
        });

        it('a MeshApp node configured with 127.0.0.1 is not reachable on another interface', async () => {
            if (!nonLoopbackIp) {
                return;
            }

            const wsTransport = new WSTransport(serializer, 0, '127.0.0.1');
            app = new MeshApp({ nodeID: 'app-bind-test', logger });
            app.use(new RegistryModule());
            app.use(new NetworkModule({
                port: 0,
                transports: [wsTransport]
            }));
            await app.start();

            const port = wsTransport.getPort();

            // 1. Dial loopback -- must succeed
            const wsLoopback = new WebSocket(`ws://127.0.0.1:${port}`);
            await new Promise<void>((resolve, reject) => {
                wsLoopback.on('open', () => {
                    wsLoopback.close();
                    resolve();
                });
                wsLoopback.on('error', reject);
            });

            // 2. Dial non-loopback IP -- must fail to connect (ECONNREFUSED)
            const wsNonLoopback = new WebSocket(`ws://${nonLoopbackIp}:${port}`);
            const error = await new Promise<Error>((resolve) => {
                wsNonLoopback.on('open', () => {
                    wsNonLoopback.close();
                    resolve(new Error('Unexpectedly connected to non-loopback interface!'));
                });
                wsNonLoopback.on('error', (err) => resolve(err));
            });

            expect((error as any).code).toBe('ECONNREFUSED');
        });
    });
});
