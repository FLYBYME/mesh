import { Logger } from './utils/Logger.js';
import { MeshApp } from './core/MeshApp.js';
import { RegistryModule } from './modules/RegistryModule.js';
import { NetworkModule } from './modules/NetworkModule.js';
import { BrokerModule } from './modules/BrokerModule.js';
import { SecurityModule } from './modules/SecurityModule.js';
import { WSTransport } from './transports/node/WSTransport.js';
import { JSONSerializer } from './serializers/JSONSerializer.js';
import { LogLevel } from './browser.js';
import { DemoSkill } from './examples/demo/demo.service.js';

/**
 * Auth Demo — Showcases Zero-Trust Authentication and Spoofing Protection.
 * 
 * Nodes Alice and Bob use Ed25519 keys to authenticate over WebSockets.
 */
async function main() {
    const logger = new Logger(LogLevel.INFO);
    const serializer = new JSONSerializer();

    // Standard Ed25519 keypair for Alice
    const aliceKeys = {
        privateKey: 'MC4CAQAwBQYDK2VwBCIEINT652f1yC5v9xS7q5M0HlXqL6m7i9Y4f8G5u6v7w8x9', // Placeholder keys
        publicKey: 'MCowBQYDK2VwAyEA9f652f1yC5v9xS7q5M0HlXqL6m7i9Y4f8G5u6v7w8x9'
    };

    // Standard Ed25519 keypair for Bob
    const bobKeys = {
        privateKey: 'MC4CAQAwBQYDK2VwBCIEIByv2f1yC5v9xS7q5M0HlXqL6m7i9Y4f8G5u6v7w8z0', 
        publicKey: 'MCowBQYDK2VwAyEAIByv2f1yC5v9xS7q5M0HlXqL6m7i9Y4f8G5u6v7w8z0'
    };

    // ─────────────────────────────────────────────────────────────────────────
    // 1. SETUP NODE 'ALICE' (Service Provider)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- 🔐 Initializing Alice (Provider) ---');
    const appAlice = new MeshApp({ nodeID: 'alice', logger });
    
    appAlice.use(new SecurityModule(aliceKeys));
    appAlice.use(new RegistryModule());
    appAlice.use(new NetworkModule({
        port: 7001,
        transports: [new WSTransport(serializer, 7001)]
    }));
    appAlice.use(new BrokerModule());

    await appAlice.registerModule(new DemoSkill());

    // ─────────────────────────────────────────────────────────────────────────
    // 2. SETUP NODE 'BOB' (Client)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- 🔐 Initializing Bob (Client) ---');
    const appBob = new MeshApp({ nodeID: 'bob', logger });
    
    appBob.use(new SecurityModule(bobKeys));
    appBob.use(new RegistryModule());
    appBob.use(new NetworkModule({
        port: 7002,
        transports: [new WSTransport(serializer, 7002)],
        bootstrapNodes: ['ws://127.0.0.1:7001']
    }));
    appBob.use(new BrokerModule());

    // ─────────────────────────────────────────────────────────────────────────
    // 3. START NODES
    // ─────────────────────────────────────────────────────────────────────────
    await appAlice.start();
    await appBob.start();

    // Wait for mutual authentication and discovery
    console.log('\n--- ⏳ Waiting for Mutual Authentication & Discovery ---');
    await appBob.registry.waitForNodes(2);
    await appBob.registry.waitForTool('demo.status');
    console.log('✅ Alice and Bob have mutually authenticated!');

    // ─────────────────────────────────────────────────────────────────────────
    // 4. TEST AUTHENTICATED CALL
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- 📡 Bob calling Alice (Authenticated) ---');
    try {
        const res = await appBob.call('demo.status', { name: 'Bob' });
        console.log('✅ Alice responded to Bob:', JSON.stringify(res));
    } catch (err) {
        console.error('❌ Bob failed to call Alice:', err);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. TEST SPOOFING PROTECTION
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- 🛡️ Testing Spoofing Protection ---');
    console.log('Scenario: Bob attempts to send a packet claiming to be "Charlie"');
    
    try {
        const networkBob = appBob.getProvider<any>('network');
        
        // Manually craft a spoofed packet
        await networkBob.send('alice', 'demo.status', { name: 'Spoofer' }, {
            senderNodeID: 'charlie' // Bob claims to be Charlie!
        });
        
        console.log('ℹ️ Bob sent a spoofed packet. Alice should detect and drop it.');
        
        // In Alice's logs (if at DEBUG/INFO level), you would see:
        // "[AuthInterceptor] Dropping spoofed packet from charlie (Authenticated as bob)"
    } catch (err) {
        console.log('ℹ️ Spoof attempt error (expected if caught):', err instanceof Error ? err.message : String(err));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6. SHUTDOWN
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- 🛑 Shutting down ---');
    await appBob.stop();
    await appAlice.stop();
    console.log('Demo complete.');
}

main().catch(console.error);
