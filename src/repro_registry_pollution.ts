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
    // 1. SETUP INITIAL NETWORK
    // ─────────────────────────────────────────────────────────────────────────
    logger.info('[Repro] Phase 1: Setting up initial 3-node network...');

    // Node 1 (Initial Provider)
    const app1 = new MeshApp({ nodeID: 'node-1-old', logger });
    const transport1 = new WSTransport(serializer, 6005);
    app1.use(new RegistryModule({ ttl: 5000 })); // Short TTL
    app1.use(new NetworkModule({ transports: [transport1] }));
    app1.use(new BrokerModule());
    await app1.registerModule(new DemoSkill());
    await app1.start();

    // Node 2 (Relay)
    const app2 = new MeshApp({ nodeID: 'node-2', logger });
    const transport2 = new WSTransport(serializer, 6006);
    app2.use(new RegistryModule({ ttl: 5000 }));
    app2.use(new NetworkModule({
        transports: [transport2],
        bootstrapNodes: ['ws://127.0.0.1:6005']
    }));
    app2.use(new BrokerModule());
    await app2.start();

    // Node 3 (Client)
    const app3 = new MeshApp({ nodeID: 'node-3', logger });
    const transport3 = new WSTransport(serializer, 6007);
    app3.use(new RegistryModule({ ttl: 5000 }));
    app3.use(new NetworkModule({
        transports: [transport3],
        bootstrapNodes: ['ws://127.0.0.1:6006']
    }));
    app3.use(new BrokerModule());
    await app3.start();

    logger.info('[Repro] Waiting for full discovery...');
    await app3.registry.waitForNodes(3);
    logger.info('[Repro] Node 3 discovery: ' + app3.registry.getNodes().map(n => n.nodeID).join(', '));

    // ─────────────────────────────────────────────────────────────────────────
    // 2. RESTART NODE 1 WITH NEW ID
    // ─────────────────────────────────────────────────────────────────────────
    logger.info('[Repro] Phase 2: Restarting Node 1 with NEW identity...');
    await app1.stop();
    await new Promise(resolve => setTimeout(resolve, 500));

    const app1New = new MeshApp({ nodeID: 'node-1-new', logger });
    const transport1New = new WSTransport(serializer, 6005); // Same port
    app1New.use(new RegistryModule({ ttl: 5000 }));
    app1New.use(new NetworkModule({
        transports: [transport1New],
        bootstrapNodes: ['ws://127.0.0.1:6006'] // Connect back to relay
    }));
    app1New.use(new BrokerModule());
    await app1New.registerModule(new DemoSkill());
    await app1New.start();

    // ─────────────────────────────────────────────────────────────────────────
    // 3. WAIT FOR TTL TO CLEAN UP GHOSTS
    // ─────────────────────────────────────────────────────────────────────────
    logger.info('[Repro] Phase 3: Waiting for TTL (12s) to clean up ghosts if PEX doesn\'t refresh them...');
    // Pruning happens every 5s, checks for age > TTL*2 (10s)
    for (let i = 0; i < 15; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const nodes = app3.registry.getNodes();
        const hasGhost = nodes.some(n => n.nodeID === 'node-1-old');
        if (!hasGhost) {
            logger.info(`[Repro] SUCCESS: Ghost "node-1-old" disappeared at T+${i+1}s!`);
            break;
        }
        if (i === 14) {
            logger.error(`[Repro] FAILURE: Ghost "node-1-old" still present after ${i+1}s.`);
            logger.error(`[Repro] Node 3 Registry: ${nodes.map(n => n.nodeID).join(', ')}`);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. TEST TOOL CALLS FROM CLIENT
    // ─────────────────────────────────────────────────────────────────────────
    logger.info('[Repro] Phase 4: Executing tool calls from Node 3 (Client)...');
    let failures = 0;
    for (let i = 0; i < 10; i++) {
        try {
            const response = await app3.call('demo.status', { name: `Repro-${i}` });
            logger.info(`[Repro] Call ${i} success: ${JSON.stringify(response)}`);
        } catch (err) {
            failures++;
            logger.error(`[Repro] Call ${i} FAILED: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    if (failures > 0) {
        logger.error(`[Repro] FAILURE: ${failures}/10 calls failed due to registry pollution!`);
    } else {
        logger.info('[Repro] No call failures detected (yet). Increase iterations or decrease TTL if needed.');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. CLEANUP
    // ─────────────────────────────────────────────────────────────────────────
    logger.info('[Repro] Shutting down...');
    await app3.stop();
    await app2.stop();
    await app1New.stop();
}

main().catch(err => {
    console.error('Fatal Repro Error:', err);
    process.exit(1);
});
