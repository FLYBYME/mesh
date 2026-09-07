import { WSTransport } from '../../transports/node/WSTransport.js';
import { JSONSerializer } from '../../serializers/JSONSerializer.js';
import { Registry } from '../../core/Registry.js';
import { MeshNetwork } from '../../core/MeshNetwork.js';
import { MeshApp } from '../../core/MeshApp.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { NetworkModule } from '../../modules/NetworkModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { ServiceBroker } from '../../core/ServiceBroker.js';
import { ServiceModule } from '../../core/ServiceModule.js';
import { defineContract } from '../../interfaces/IToolContract.js';
import { z } from 'zod';

describe('WSTransport Handshake Authentication', () => {
    const logger = new Logger(LogLevel.ERROR);
    const serializer = new JSONSerializer();
    const originalEnv = process.env.MESH_KEY;

    afterEach(() => {
        if (originalEnv !== undefined) {
            process.env.MESH_KEY = originalEnv;
        } else {
            delete process.env.MESH_KEY;
        }
    });

    describe('Direct transport handshake tests', () => {
        let serverTransport: WSTransport;
        let clientTransport: WSTransport;

        afterEach(async () => {
            if (clientTransport) {
                await clientTransport.disconnect();
            }
            if (serverTransport) {
                await serverTransport.disconnect();
            }
        });

        it('should allow connection when correct key is provided', async () => {
            const secretKey = 'test-secret-key-123';
            serverTransport = new WSTransport(serializer, 0, '127.0.0.1', { authKey: secretKey });
            await serverTransport.connect({ nodeID: 'server-node', namespace: 'default', url: '', logger });
            const port = serverTransport.getPort();

            clientTransport = new WSTransport(serializer, 0, '127.0.0.1', { authKey: secretKey });
            await clientTransport.connect({ nodeID: 'client-node', namespace: 'default', url: '', logger });

            await expect(clientTransport.connectToPeer('server-node', `ws://127.0.0.1:${port}`)).resolves.toBeUndefined();
            expect(clientTransport.isPeerConnected('server-node')).toBe(true);
        });

        it('should reject dialler with 403 when wrong key is provided', async () => {
            serverTransport = new WSTransport(serializer, 0, '127.0.0.1', { authKey: 'correct-secret' });
            await serverTransport.connect({ nodeID: 'server-node', namespace: 'default', url: '', logger });
            const port = serverTransport.getPort();

            clientTransport = new WSTransport(serializer, 0, '127.0.0.1', { authKey: 'wrong-secret' });
            await clientTransport.connect({ nodeID: 'client-node', namespace: 'default', url: '', logger });

            await expect(clientTransport.connectToPeer('server-node', `ws://127.0.0.1:${port}`)).rejects.toThrow('403');
            expect(clientTransport.isPeerConnected('server-node')).toBe(false);
        });

        it('should reject dialler with 401 when key is missing and server requires key', async () => {
            delete process.env.MESH_KEY;
            serverTransport = new WSTransport(serializer, 0, '127.0.0.1', { authKey: 'correct-secret' });
            await serverTransport.connect({ nodeID: 'server-node', namespace: 'default', url: '', logger });
            const port = serverTransport.getPort();

            clientTransport = new WSTransport(serializer, 0, '127.0.0.1');
            await clientTransport.connect({ nodeID: 'client-node', namespace: 'default', url: '', logger });

            await expect(clientTransport.connectToPeer('server-node', `ws://127.0.0.1:${port}`)).rejects.toThrow('401');
            expect(clientTransport.isPeerConnected('server-node')).toBe(false);
        });

        it('should read key from process.env.MESH_KEY when not provided in options', async () => {
            process.env.MESH_KEY = 'env-secret-key';
            serverTransport = new WSTransport(serializer, 0, '127.0.0.1');
            await serverTransport.connect({ nodeID: 'server-node', namespace: 'default', url: '', logger });
            const port = serverTransport.getPort();

            clientTransport = new WSTransport(serializer, 0, '127.0.0.1');
            await clientTransport.connect({ nodeID: 'client-node', namespace: 'default', url: '', logger });

            await expect(clientTransport.connectToPeer('server-node', `ws://127.0.0.1:${port}`)).resolves.toBeUndefined();
            expect(clientTransport.isPeerConnected('server-node')).toBe(true);
        });

        it('should allow unauthenticated loopback when no key is configured anywhere', async () => {
            delete process.env.MESH_KEY;
            serverTransport = new WSTransport(serializer, 0, '127.0.0.1');
            await serverTransport.connect({ nodeID: 'server-node', namespace: 'default', url: '', logger });
            const port = serverTransport.getPort();

            clientTransport = new WSTransport(serializer, 0, '127.0.0.1');
            await clientTransport.connect({ nodeID: 'client-node', namespace: 'default', url: '', logger });

            await expect(clientTransport.connectToPeer('server-node', `ws://127.0.0.1:${port}`)).resolves.toBeUndefined();
            expect(clientTransport.isPeerConnected('server-node')).toBe(true);
        });

        it('verifyHandshake unit test: accepts Authorization Bearer header', (done) => {
            serverTransport = new WSTransport(serializer, 0, '127.0.0.1', { authKey: 'my-token' });
            const mockReq = {
                headers: { authorization: 'Bearer my-token' },
                socket: { remoteAddress: '127.0.0.1' },
                url: '/'
            } as any;

            serverTransport.verifyHandshake({ req: mockReq }, (result) => {
                expect(result).toBe(true);
                done();
            });
        });

        it('verifyHandshake unit test: accepts URL query parameter', (done) => {
            serverTransport = new WSTransport(serializer, 0, '127.0.0.1', { authKey: 'query-token' });
            const mockReq = {
                headers: {},
                socket: { remoteAddress: '127.0.0.1' },
                url: '/?key=query-token'
            } as any;

            serverTransport.verifyHandshake({ req: mockReq }, (result) => {
                expect(result).toBe(true);
                done();
            });
        });

        it('verifyHandshake unit test: rejects non-loopback when no key is configured', (done) => {
            delete process.env.MESH_KEY;
            serverTransport = new WSTransport(serializer, 0, '127.0.0.1');
            const mockReq = {
                headers: {},
                socket: { remoteAddress: '198.51.100.1' },
                url: '/'
            } as any;

            serverTransport.verifyHandshake({ req: mockReq }, (result, code, message) => {
                expect(result).toBe(false);
                expect(code).toBe(401);
                expect(message).toContain('authentication key required');
                done();
            });
        });

        it('refuses to start listener on non-loopback host (0.0.0.0) without MESH_KEY', async () => {
            delete process.env.MESH_KEY;
            serverTransport = new WSTransport(serializer, 0, '0.0.0.0');
            await expect(serverTransport.connect({
                nodeID: 'server-node',
                namespace: 'default',
                url: '',
                logger
            })).rejects.toThrow(/Refusing to start on non-loopback host "0.0.0.0" without authentication key.*MESH_KEY/);
        });

        it('refuses to start listener on non-loopback IP (198.51.100.1) without MESH_KEY', async () => {
            delete process.env.MESH_KEY;
            serverTransport = new WSTransport(serializer, 0, '198.51.100.1');
            await expect(serverTransport.connect({
                nodeID: 'server-node',
                namespace: 'default',
                url: '',
                logger
            })).rejects.toThrow(/Refusing to start on non-loopback host "198.51.100.1" without authentication key.*MESH_KEY/);
        });

        it('allows starting on non-loopback host when MESH_KEY is set', async () => {
            process.env.MESH_KEY = 'secret-fleet-key';
            serverTransport = new WSTransport(serializer, 0, '0.0.0.0');
            await expect(serverTransport.connect({
                nodeID: 'server-node',
                namespace: 'default',
                url: '',
                logger
            })).resolves.toBeUndefined();
            expect(serverTransport.isConnected()).toBe(true);
        });
    });

    describe('MeshApp & Registry isolation tests', () => {
        let appServer: MeshApp | undefined;
        let appClientCorrect: MeshApp | undefined;
        let appClientWrong: MeshApp | undefined;
        let appClientMissing: MeshApp | undefined;

        afterEach(async () => {
            if (appClientMissing) await appClientMissing.stop();
            if (appClientWrong) await appClientWrong.stop();
            if (appClientCorrect) await appClientCorrect.stop();
            if (appServer) await appServer.stop();
        });

        it('a correct key connects and can call tools remotely across nodes', async () => {
            const secretKey = 'shared-fleet-key';

            appServer = new MeshApp({ nodeID: 'auth-server', logger });
            appServer.use(new RegistryModule());
            appServer.use(new NetworkModule({
                port: 6401,
                transports: [new WSTransport(serializer, 6401, '127.0.0.1', { authKey: secretKey })]
            }));
            appServer.use(new BrokerModule());
            await appServer.start();

            const mathContract = defineContract({
                domain: 'math',
                action: 'add',
                description: 'Add numbers',
                inputSchema: z.object({ a: z.number(), b: z.number() }),
                outputSchema: z.object({ sum: z.number() }),
                dependencies: []
            });

            class MathService extends ServiceModule {
                readonly domain = 'math';
                constructor() {
                    super();
                    this.mountTool(mathContract, async (params: any) => {
                        return { sum: params.a + params.b };
                    });
                }
            }
            await appServer.registerModule(new MathService());

            // Client with matching key
            appClientCorrect = new MeshApp({ nodeID: 'auth-client-good', logger });
            appClientCorrect.use(new RegistryModule());
            appClientCorrect.use(new NetworkModule({
                port: 6402,
                transports: [new WSTransport(serializer, 6402, '127.0.0.1', { authKey: secretKey })],
                bootstrapNodes: ['ws://127.0.0.1:6401']
            }));
            appClientCorrect.use(new BrokerModule());
            await appClientCorrect.start();

            await new Promise(r => setTimeout(r, 600));

            const serverRegistry = appServer.getProvider<Registry>('registry');
            const clientRegistry = appClientCorrect.getProvider<Registry>('registry');
            const clientBroker = appClientCorrect.getProvider<ServiceBroker>('broker');

            expect(serverRegistry.getNode('auth-client-good')).toBeDefined();
            expect(clientRegistry.getNode('auth-server')).toBeDefined();

            const res = await clientBroker.call('math.add', { a: 10, b: 32 });
            expect(res).toEqual({ sum: 42 });
        });

        it('a wrong key and a missing key are refused and neither reaches the registry', async () => {
            const secretKey = 'fleet-secret';

            appServer = new MeshApp({ nodeID: 'secure-server', logger });
            appServer.use(new RegistryModule());
            appServer.use(new NetworkModule({
                port: 6411,
                transports: [new WSTransport(serializer, 6411, '127.0.0.1', { authKey: secretKey })]
            }));
            appServer.use(new BrokerModule());
            await appServer.start();

            const serverRegistry = appServer.getProvider<Registry>('registry');

            // 1. Client with wrong key
            appClientWrong = new MeshApp({ nodeID: 'wrong-key-client', logger });
            appClientWrong.use(new RegistryModule());
            appClientWrong.use(new NetworkModule({
                port: 6412,
                transports: [new WSTransport(serializer, 6412, '127.0.0.1', { authKey: 'bad-key' })],
                bootstrapNodes: ['ws://127.0.0.1:6411']
            }));
            appClientWrong.use(new BrokerModule());
            await appClientWrong.start();

            await new Promise(r => setTimeout(r, 600));
            expect(serverRegistry.getNode('wrong-key-client')).toBeUndefined();
            expect(serverRegistry.getNodes().some(n => n.nodeID === 'wrong-key-client')).toBe(false);

            // 2. Client with missing key
            delete process.env.MESH_KEY;
            appClientMissing = new MeshApp({ nodeID: 'missing-key-client', logger });
            appClientMissing.use(new RegistryModule());
            appClientMissing.use(new NetworkModule({
                port: 6413,
                transports: [new WSTransport(serializer, 6413, '127.0.0.1')],
                bootstrapNodes: ['ws://127.0.0.1:6411']
            }));
            appClientMissing.use(new BrokerModule());
            await appClientMissing.start();

            await new Promise(r => setTimeout(r, 600));
            expect(serverRegistry.getNode('missing-key-client')).toBeUndefined();
            expect(serverRegistry.getNodes().some(n => n.nodeID === 'missing-key-client')).toBe(false);
        });
    });
});
