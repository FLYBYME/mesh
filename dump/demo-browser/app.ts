import { MeshClient } from '../src/generated/client/MeshClient';
import { createMeshApp } from '../src/core/MeshApp';
import { ServiceBroker } from '../src/core/ServiceBroker';
import { ServiceRegistry } from '../src/core/ServiceRegistry';
import { MeshNetwork } from '../src/core/MeshNetwork';
import { WSTransport } from '../src/transports/browser/BrowserWebSocketTransport';
import { JSONSerializer } from '../src/serializers/JSONSerializer';

const output = document.getElementById('output') as HTMLPreElement;
const btn = document.getElementById('run-btn') as HTMLButtonElement;
const input = document.getElementById('name-input') as HTMLInputElement;

const log = (msg: string) => {
    output.textContent += msg + '\n';
    output.scrollTop = output.scrollHeight;
};

try {
    log('Initializing MeshApp in Browser...');
    
    // 1. Boot the Isomorphic MeshApp
    const app = createMeshApp({ nodeID: 'browser-client' });
    
    // 2. Initialize Networking
    const broker = new ServiceBroker(app);
    const registry = new ServiceRegistry(app.logger);
    app.registerProvider('broker', broker);
    app.registerProvider('registry', registry);
    broker.setRegistry(registry);

    const RegistryPlugin = (await import('../src/RegistryPlugin')).RegistryPlugin;
    broker.pipe(new RegistryPlugin(registry));

    const network = new MeshNetwork({
        bootstrapNodes: ['ws://localhost:3000'],
        transports: [new WSTransport(new JSONSerializer())]
    }, app.logger, registry);
    broker.setNetwork(network);

    await app.start();
    await network.start();
    log('Connected to Mesh Network!');

    // 3. Initialize the strongly-typed auto-generated SDK
    const client = new MeshClient(app);

    btn.addEventListener('click', async () => {
        const name = input.value || 'Anonymous';
        log(`\nExecuting api.demo.hello({ name: "${name}" }) via SDK...`);
        btn.disabled = true;

        try {
            // The SDK validates typings and routes it perfectly over the mesh!
            const result = await client.api.demo.hello({ name }, { nodeID: 'demo-node-1' });
            log(`Server Response: ${JSON.stringify(result, null, 2)}`);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            log(`Error: ${message}`);
        } finally {
            btn.disabled = false;
        }
    });
} catch (err: unknown) {
    log(`Failed to initialize: ${err}`);
}
