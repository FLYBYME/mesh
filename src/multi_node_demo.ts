import { Logger } from './utils/Logger.js';
import { MeshApp } from './core/MeshApp.js';
import { RegistryModule } from './modules/RegistryModule.js';
import { NetworkModule } from './modules/NetworkModule.js';
import { BrokerModule } from './modules/BrokerModule.js';
import { WSTransport } from './transports/node/WSTransport.js';
import { JSONSerializer } from './serializers/JSONSerializer.js';
import { DemoSkill } from './examples/demo/demo.service.js';

async function main() {
    const logger = new Logger();
    const serializer = new JSONSerializer();

    // ─────────────────────────────────────────────────────────────────────────
    // 1. SETUP NODE 1 (Bootstrap & Service Provider)
    // ─────────────────────────────────────────────────────────────────────────
    logger.info('[Demo] Initializing Node 1 via MeshApp...');

    const app1 = new MeshApp({
        nodeID: 'node-1',
        logger
    });

    const transport1 = new WSTransport(serializer, 5005);

    app1.use(new RegistryModule());
    app1.use(new NetworkModule({
        port: 5005,
        transports: [transport1]
    }));
    app1.use(new BrokerModule());

    // Register Demo skill on node-1
    await app1.registerModule(new DemoSkill());

    // ─────────────────────────────────────────────────────────────────────────
    // 2. SETUP NODE 2 (Caller Client Node)
    // ─────────────────────────────────────────────────────────────────────────
    logger.info('[Demo] Initializing Node 2 via MeshApp...');

    const app2 = new MeshApp({
        nodeID: 'node-2',
        logger
    });

    const transport2 = new WSTransport(serializer, 5006);

    app2.use(new RegistryModule());
    app2.use(new NetworkModule({
        port: 5006,
        transports: [transport2],
        bootstrapNodes: ['ws://127.0.0.1:5005']
    }));
    app2.use(new BrokerModule());

    // ─────────────────────────────────────────────────────────────────────────
    // 3. START BOTH NODES
    // ─────────────────────────────────────────────────────────────────────────
    logger.info('[Demo] Starting Node 1 Network...');
    await app1.start();

    logger.info('[Demo] Starting Node 2 Network...');
    await app2.start();

    // ─────────────────────────────────────────────────────────────────────────
    // 4. WAIT FOR PEER DISCOVERY & TOOL REGISTRATION
    // ─────────────────────────────────────────────────────────────────────────
    logger.info('[Demo] Waiting for Node 2 to discover Node 1...');
    await app2.registry.waitForNodes(2);
    logger.info('[Demo] Both nodes registered in Node 2\'s routing table!');

    logger.info('[Demo] Waiting for "demo.status" tool discovery on Node 2...');
    await app2.registry.waitForTool('demo.status');
    logger.info('[Demo] Tool "demo.status" is now resolvable by Node 2!');

    // ─────────────────────────────────────────────────────────────────────────
    // 5. INITIATE MULTI-NODE RPC PACKET HOP
    // ─────────────────────────────────────────────────────────────────────────
    logger.info('[Demo] Node 2 is executing RPC "demo.status" targeting Node 1...');
    try {
        const response = await app2.call('demo.status', { name: 'MultiNode-Hop-Client' });
        logger.info(`[Demo] Success! RPC Response received on Node 2: ${JSON.stringify(response)}`);
    } catch (err) {
        logger.error(`[Demo] RPC Execution Failed:`, { error: err });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6. SHUTDOWN & CLEANUP
    // ─────────────────────────────────────────────────────────────────────────
    logger.info('[Demo] Shutting down Node 2...');
    await app2.stop();

    logger.info('[Demo] Shutting down Node 1...');
    await app1.stop();

    logger.info('[Demo] Multi-node packet hop test complete!');
}

main().catch(err => {
    console.error('Fatal Demo Error:', err);
    process.exit(1);
});
