import * as dotenv from 'dotenv';
dotenv.config();

import { z } from 'zod';
import express from 'express';
import path from 'path';
import { defineContract, defaultPrint } from '../contracts/tool_contract';
import { defineCrud } from '../contracts/crud_contract';
import { BaseServiceModule } from '../services/ServiceModule';
import { MeshEngine } from '../engine/MeshEngine';
import { IMeshApi } from '../services/api';
import { createMeshApp } from '../core/MeshApp';
import { ServiceBroker } from '../core/ServiceBroker';
import { LogLevel } from '../interfaces';
import { ConsoleLogger } from '../utils/ConsoleLogger';
import { ServiceRegistry } from '../core/ServiceRegistry';
import { MeshNetwork } from '../core/MeshNetwork';
import { WSTransport } from '../transports/node/WSTransport';
import { JSONSerializer } from '../serializers/JSONSerializer';

import { demoHelloContract, userCrud, BaseUserSchema, DbUserSchema } from './demo.contract';

// 2. Implement a Service Module
class DemoService extends BaseServiceModule {
    public readonly domain = 'demo';

    constructor() {
        super();
        this.mountTool(demoHelloContract, async (input, ctx) => {
            console.log(`[DemoService] Executing hello for ${input.name}`);

            // Example of using the database if connected
            if (ctx.db) {
                try {
                    const count = await ctx.db.repo(DbUserSchema, 'demo').count();
                    console.log(`[DemoService] Total users in DB: ${count}`);
                } catch (e) {
                    console.log(`[DemoService] Database not connected or error: ${e}`);
                }
            }

            return {
                message: `Hello, ${input.name}! Welcome to the Mesh Service Architecture.`
            };
        });

        // Mount auto-generated CRUD routes
        this.mountCrud(userCrud);

        // Add a hook to the CRUD creation
        this.mountCrudHook('demo', 'create_user', {
            before: async (input: z.infer<typeof BaseUserSchema>, ctx) => {
                console.log(`[DemoService] Hook intercepted create_user for ${input.email}`);
                return input;
            }
        });
    }
}

// 3. Boot the Engine and App
async function runDemo() {
    console.log('--- Starting Mesh Broker & Service Engine Demo ---');

    // Create the global Mesh App (DI Container)
    const logger = new ConsoleLogger({}, LogLevel.DEBUG);
    const nodeID = 'demo-node-1';
    const app = createMeshApp({ nodeID, logger });

    // Initialize the Broker and Registry
    const broker = new ServiceBroker(app);
    const registry = new ServiceRegistry(logger, { localNodeID: nodeID, dhtEnabled: true });
    app.registerProvider('broker', broker);
    app.registerProvider('registry', registry);
    broker.setRegistry(registry);

    // Initialize the Service Engine
    const engine = new MeshEngine();
    engine.registry.register(new DemoService());
    await engine.boot({} as any);

    // Advertise the MeshEngine services to the MeshNetwork so other nodes (like the browser) can discover them!
    registry.registerService({
        name: 'demo',
        actions: [{ name: 'demo:hello' }]
    } as any);

    // Bridge ServiceBroker to MeshEngine
    broker.useLocal(async (ctx, next) => {
        try {
            return await next();
        } catch (e: any) {
            if (e.message && e.message.includes('Local action not found')) {
                const [domain, action] = ctx.actionName.split(':');
                if (engine.registry.getService(domain)) {
                    const engineCtx = engine.createContext(undefined, ctx.correlationID);
                    return await engine.executor.execute(domain, action, ctx.params, engineCtx);
                }
            }
            throw e;
        }
    });

    // Setup MeshNetwork
    const network = new MeshNetwork({
        nodeId: nodeID,
        port: 3000,
        transports: [new WSTransport(new JSONSerializer())]
    }, logger, registry);
    broker.setNetwork(network);

    await app.start();
    await network.start();

    const expressApp = network.server?.getApp() as any;
    if (expressApp) {
        const browserPath = path.join(process.cwd(), 'demo-browser');
        expressApp.use(express.static(browserPath));
        expressApp.get('/', (req: any, res: any) => {
            res.sendFile(path.join(browserPath, 'index.html'));
        });
        console.log(`[Demo] Serving static browser client from ${browserPath} at http://localhost:3000`);
    }

    // Create a context and execute the contract locally
    console.log('\n--- Executing Contract Locally ---');
    try {
        const result = await app.call('demo:hello', { name: 'Developer' });
        console.log('Local Result:', result);
    } catch (err) {
        console.error('Local Execution failed:', err);
    }

    console.log('\n[Demo] Server is running! Open the browser demo to test it.');
    console.log('[Demo] Press Ctrl+C to stop.\n');

    // Keep process alive for connections
    process.on('SIGINT', async () => {
        console.log('\n--- Shutting Down ---');
        await network.stop();
        await engine.shutdown();
        await app.stop();
        process.exit(0);
    });
}

runDemo().catch(console.error);
