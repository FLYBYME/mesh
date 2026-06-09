import { Logger } from './utils/Logger.js';
import { MeshApp } from './core/MeshApp.js';
import { RegistryModule } from './modules/RegistryModule.js';
import { NetworkModule } from './modules/NetworkModule.js';
import { BrokerModule } from './modules/BrokerModule.js';
import { WSTransport } from './transports/node/WSTransport.js';
import { JSONSerializer } from './serializers/JSONSerializer.js';
import { DemoSkill } from './examples/demo/demo.service.js';
import { LogLevel } from './browser.js';

async function main() {
    const logger = new Logger(LogLevel.INFO);
    const serializer = new JSONSerializer();

    logger.info('[Repro] Initializing Stable Provider (Node 1)...');
    const app1 = new MeshApp({ nodeID: 'node-1', logger });
    const transport1 = new WSTransport(serializer, 6005);
    app1.use(new RegistryModule({ ttl: 5000 })); // Short TTL for faster repro
    app1.use(new NetworkModule({ transports: [transport1] }));
    app1.use(new BrokerModule());
    await app1.registerModule(new DemoSkill());
    await app1.start();

    logger.info('[Repro] Cycling ephemeral nodes...');
    for (let i = 0; i < 5; i++) {
        const nodeID = `ephemeral-${i}`;
        logger.info(`[Repro] Starting ${nodeID}...`);
        const app = new MeshApp({ nodeID, logger });
        const transport = new WSTransport(serializer, 7000 + i);
        app.use(new RegistryModule({ ttl: 5000 }));
        app.use(new NetworkModule({
            transports: [transport],
            bootstrapNodes: ['ws://127.0.0.1:6005']
        }));
        app.use(new BrokerModule());
        // Register the SAME tool so we have multiple providers
        await app.registerModule(new DemoSkill());
        await app.start();

        // Wait a bit for discovery
        await new Promise(resolve => setTimeout(resolve, 500));
        
        logger.info(`[Repro] Stopping ${nodeID}...`);
        // Stop without proper cleanup? No, app.stop() is what users call.
        // We want to see if they stay in Node 1's registry even after stop.
        await app.stop();
    }

    logger.info('[Repro] Ephemeral cycle complete. Checking Node 1 registry...');
    const nodes = app1.registry.getNodes();
    logger.info(`[Repro] Node 1 sees ${nodes.length} nodes in registry: ${nodes.map(n => `${n.nodeID} (avail: ${n.available})`).join(', ')}`);

    logger.info('[Repro] Initializing Client (Node 2)...');
    const app2 = new MeshApp({ nodeID: 'node-2', logger });
    const transport2 = new WSTransport(serializer, 6006);
    app2.use(new RegistryModule({ ttl: 5000 }));
    app2.use(new NetworkModule({
        transports: [transport2],
        bootstrapNodes: ['ws://127.0.0.1:6005']
    }));
    app2.use(new BrokerModule());
    await app2.start();

    // Wait for discovery of at least Node 1
    await app2.registry.waitForNodes(2); 
    
    logger.info(`[Repro] Node 2 sees ${app2.registry.getNodes().length} nodes.`);

    logger.info('[Repro] Executing tool calls from Node 2...');
    for (let i = 0; i < 10; i++) {
        try {
            logger.info(`[Repro] Call ${i+1}/10...`);
            const response = await app2.call('demo.status', { name: 'Repro-Client' });
            logger.info(`[Repro] Success: ${JSON.stringify(response)}`);
        } catch (err) {
            logger.error(`[Repro] Failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    logger.info('[Repro] Shutting down...');
    await app2.stop();
    await app1.stop();
}

main().catch(err => {
    console.error('Fatal Repro Error:', err);
    process.exit(1);
});
