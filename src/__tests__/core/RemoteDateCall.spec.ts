import { MeshApp } from '../../core/MeshApp.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { NetworkModule } from '../../modules/NetworkModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { WSTransport } from '../../transports/node/WSTransport.js';
import { JSONSerializer } from '../../serializers/JSONSerializer.js';
import { ServiceModule } from '../../core/ServiceModule.js';
import { defineContract } from '../../interfaces/IToolContract.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { ServiceBroker } from '../../core/ServiceBroker.js';
import { z } from 'zod';

describe('Remote call date preservation', () => {
    let serverApp: MeshApp;
    let clientApp: MeshApp;
    const logger = new Logger(LogLevel.ERROR);
    const serializer = new JSONSerializer();

    const UserSchema = z.object({
        id: z.string(),
        name: z.string(),
        createdAt: z.date(),
        updatedAt: z.date()
    });

    const userFindContract = defineContract({
        domain: 'user',
        action: 'find',
        description: 'Find users',
        inputSchema: z.object({}),
        outputSchema: z.array(UserSchema),
        dependencies: []
    });

    const fixedDate = new Date('2026-09-07T02:00:00.000Z');

    class UserService extends ServiceModule {
        readonly domain = 'user';
        constructor() {
            super();
            this.mountTool(userFindContract, async () => {
                return [
                    {
                        id: 'usr_1',
                        name: 'Alice',
                        createdAt: fixedDate,
                        updatedAt: fixedDate
                    }
                ];
            });
        }
    }

    beforeAll(async () => {
        serverApp = new MeshApp({ nodeID: 'date-server-node', logger });
        serverApp.use(new RegistryModule());
        serverApp.use(new NetworkModule({
            port: 6501,
            transports: [new WSTransport(serializer, 6501, '127.0.0.1')]
        }));
        serverApp.use(new BrokerModule());
        await serverApp.start();
        await serverApp.registerModule(new UserService());

        clientApp = new MeshApp({ nodeID: 'date-client-node', logger });
        clientApp.use(new RegistryModule());
        clientApp.use(new NetworkModule({
            port: 6502,
            transports: [new WSTransport(serializer, 6502, '127.0.0.1')],
            bootstrapNodes: ['ws://127.0.0.1:6501']
        }));
        clientApp.use(new BrokerModule());
        await clientApp.start();

        await new Promise(r => setTimeout(r, 600));
    });

    afterAll(async () => {
        await clientApp?.stop();
        await serverApp?.stop();
    });

    it('reproduces date failure when calling user.find remotely', async () => {
        const clientBroker = clientApp.getProvider<ServiceBroker>('broker');
        const users = await clientBroker.call('user.find', {}) as Array<{
            id: string;
            name: string;
            createdAt: Date;
            updatedAt: Date;
        }>;

        expect(users).toHaveLength(1);
        expect(users[0]!.createdAt).toBeInstanceOf(Date);
        expect(users[0]!.createdAt.getTime()).toBe(fixedDate.getTime());
        expect(users[0]!.updatedAt).toBeInstanceOf(Date);
        expect(users[0]!.updatedAt.getTime()).toBe(fixedDate.getTime());
    });
});
