import { MeshApp } from '../../src/core/MeshApp.js';
import { RegistryModule } from '../../src/modules/RegistryModule.js';
import { NetworkModule } from '../../src/modules/NetworkModule.js';
import { BrokerModule } from '../../src/modules/BrokerModule.js';
import { Registry } from '../../src/core/Registry.js';
import { MeshNetwork } from '../../src/core/MeshNetwork.js';
import { ServiceBroker } from '../../src/core/ServiceBroker.js';
import { MockTransport } from '../../src/transports/MockTransport.js';
import { JSONSerializer } from '../../src/serializers/JSONSerializer.js';

describe('Lifecycle Modules', () => {
    let app: MeshApp;
    const serializer = new JSONSerializer();

    beforeEach(() => {
        app = new MeshApp({ nodeID: 'test-node' });
    });

    it('should correctly initialize and register RegistryModule', async () => {
        app.use(new RegistryModule());
        await app.start();

        const registry = app.getProvider('registry');
        expect(registry).toBeInstanceOf(Registry);
        expect(app.registry).toBe(registry);
    });

    it('should correctly initialize and register NetworkModule', async () => {
        app.use(new RegistryModule());
        app.use(new NetworkModule({ transports: [new MockTransport(serializer)] }));
        await app.start();

        const network = app.getProvider('network');
        expect(network).toBeInstanceOf(MeshNetwork);
    });

    it('should correctly initialize and register BrokerModule', async () => {
        app.use(new RegistryModule());
        app.use(new NetworkModule({ transports: [new MockTransport(serializer)] }));
        app.use(new BrokerModule());
        await app.start();

        const broker = app.getProvider('broker');
        expect(broker).toBeInstanceOf(ServiceBroker);
    });

    it('should fail NetworkModule if RegistryModule is missing', async () => {
        app.use(new NetworkModule({ transports: [new MockTransport(serializer)] }));
        await expect(app.start()).rejects.toThrow('[MeshApp] Provider not found for token: registry');
    });
});
