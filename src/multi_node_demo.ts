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

    // ─────────────────────────────────────────────────────────────────────────
    // 1. SETUP NODE 1 (Service Provider)
    // ─────────────────────────────────────────────────────────────────────────
    logger.info('[Demo] Initializing Node 1 (Provider)...');

    const app1 = new MeshApp({
        nodeID: 'node-1',
        logger
    });

    const transport1 = new WSTransport(serializer, 6005);

    app1.use(new RegistryModule());
    app1.use(new NetworkModule({
        transports: [transport1]
    }));
    app1.use(new BrokerModule());

    // Register Demo skill on node-1
    await app1.registerModule(new DemoSkill());

    // ─────────────────────────────────────────────────────────────────────────
    // 2. SETUP NODE 2 (Relay Node)
    // ─────────────────────────────────────────────────────────────────────────
    logger.info('[Demo] Initializing Node 2 (Relay)...');

    const app2 = new MeshApp({
        nodeID: 'node-2',
        logger
    });

    const transport2 = new WSTransport(serializer, 6006);

    app2.use(new RegistryModule());
    app2.use(new NetworkModule({
        transports: [transport2],
        bootstrapNodes: ['ws://127.0.0.1:6005']
    }));
    app2.use(new BrokerModule());

    // ─────────────────────────────────────────────────────────────────────────
    // 3. SETUP NODE 3 (Caller Client Node)
    // ─────────────────────────────────────────────────────────────────────────
    logger.info('[Demo] Initializing Node 3 (Client)...');

    const app3 = new MeshApp({
        nodeID: 'node-3',
        logger
    });

    const transport3 = new WSTransport(serializer, 6007);

    app3.use(new RegistryModule());
    app3.use(new NetworkModule({
        transports: [transport3],
        // Node 3 ONLY connects to Node 2, forcing a hop to reach Node 1
        bootstrapNodes: ['ws://127.0.0.1:6006']
    }));
    app3.use(new BrokerModule());

    // ─────────────────────────────────────────────────────────────────────────
    // 4. START ALL NODES
    // ─────────────────────────────────────────────────────────────────────────
    logger.info('[Demo] Starting Node 1 Network...');
    await app1.start();

    logger.info('[Demo] Starting Node 2 Network...');
    await app2.start();

    logger.info('[Demo] Starting Node 3 Network...');
    await app3.start();

    // ─────────────────────────────────────────────────────────────────────────
    // 5. WAIT FOR PEER DISCOVERY & TOOL REGISTRATION
    // ─────────────────────────────────────────────────────────────────────────
    logger.info('[Demo] Waiting for Node 3 to discover the network chain...');
    // Node 3 should eventually see 3 nodes (1, 2, and itself)
    await app3.registry.waitForNodes(3);
    logger.info('[Demo] Node 3 has discovered all nodes in the chain!');

    logger.info('[Demo] Waiting for "demo.status" tool discovery on Node 3...');
    await app3.registry.waitForTool('demo.status');
    logger.info('[Demo] Tool "demo.status" is now resolvable by Node 3 via Node 2!');

    // ─────────────────────────────────────────────────────────────────────────
    // 6. INITIATE MULTI-HOP RPC PACKET HOP
    // ─────────────────────────────────────────────────────────────────────────
    logger.info('[Demo] Node 3 executing RPC "demo.status" targeting Node 1 (via Node 2)...');
    try {
        const response = await app3.call('demo.status', { name: 'Multi-Hop-Client' });
        console.log(`[Demo] Success! RPC Response received on Node 3: ${JSON.stringify(response)}`);
    } catch (err) {
        logger.error(`[Demo] RPC Execution Failed:`, { error: err });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 7. SHUTDOWN & CLEANUP
    // ─────────────────────────────────────────────────────────────────────────
    logger.info('[Demo] Shutting down nodes...');
    await app3.stop();
    await app2.stop();
    await app1.stop();

    logger.info('[Demo] Multi-hop packet test complete!');
}

main().catch(err => {
    console.error('Fatal Demo Error:', err);
    process.exit(1);
});
