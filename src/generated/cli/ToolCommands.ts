// GENERATED FILE - DO NOT EDIT
import { Command } from 'commander';
import { MeshApp } from '../../core/MeshApp.js';
import { ZodToCliMapper } from '../../cli/core/ZodToCliMapper.js';
import { C } from '../../cli/core/Utils.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { NetworkModule } from '../../modules/NetworkModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { WSTransport } from '../../transports/node/WSTransport.js';
import { JSONSerializer } from '../../serializers/JSONSerializer.js';
import { Logger } from '../../utils/Logger.js';
import * as Contract_0 from '../../examples/demo/demo.contract.js';

async function executeCommand(toolName: string, args: Record<string, unknown>, contract: any, options: any) {
    const logger = new Logger(3); // Error level to avoid cluttering CLI output
    const nodeId = options.nodeId || `cli-${Math.random().toString(36).substring(2, 9)}`;
    const app = new MeshApp({ nodeID: nodeId, logger });
    const serializer = new JSONSerializer();
    const port = parseInt(options.port || '0', 10);
    const wsTransport = new WSTransport(serializer, port);
    
    const bootstrapStr = options.bootstrap || 'ws://127.0.0.1:5005';
    app.use(new RegistryModule());
    app.use(new NetworkModule({
        port,
        transports: [wsTransport] as any,
        bootstrapNodes: bootstrapStr ? bootstrapStr.split(',').map((s: string) => s.trim()) : []
    }));
    app.use(new BrokerModule());

    await app.start();
    
    // Wait briefly for discovery if bootstrap is provided
    if (bootstrapStr) {
        await new Promise(r => setTimeout(r, 1000)); // basic wait for registry sync
    }

    try {
        app.logger.info(C.dim + `Executing ${toolName}...` + C.reset);
        const res = await app.call(toolName as any, ZodToCliMapper.parseOptions(args, contract.inputSchema) as any, { timeout: 300000 });
        app.logger.info(contract.print(res));
    } finally {
        await app.stop();
    }
}

export function registerGeneratedCommands(program: Command) {
    const demo = program.command('demo').description('demo tools');
    const cmd_demo_demoHelloContract_hello = demo.command('hello').description(`A simple hello world tool for demonstration.`);
    cmd_demo_demoHelloContract_hello.action(async (o: Record<string, unknown>, cmd: Command) => {
        try {
            await executeCommand('demo.hello', o, Contract_0.demoHelloContract, cmd.optsWithGlobals());
            process.exit(0);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(C.red + 'Error:' + C.reset, message);
            process.exit(1);
        }
    });
    ZodToCliMapper.applyOptions(cmd_demo_demoHelloContract_hello, Contract_0.demoHelloContract.inputSchema);
    const cmd_demo_demoStatusContract_status = demo.command('status').description(`Check the status of the demo environment.`);
    cmd_demo_demoStatusContract_status.action(async (o: Record<string, unknown>, cmd: Command) => {
        try {
            await executeCommand('demo.status', o, Contract_0.demoStatusContract, cmd.optsWithGlobals());
            process.exit(0);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(C.red + 'Error:' + C.reset, message);
            process.exit(1);
        }
    });
    ZodToCliMapper.applyOptions(cmd_demo_demoStatusContract_status, Contract_0.demoStatusContract.inputSchema);
    const cmd_demo_demoNotifyContract_notify = demo.command('notify').description(`Send a notification via the system notifications service.`);
    cmd_demo_demoNotifyContract_notify.action(async (o: Record<string, unknown>, cmd: Command) => {
        try {
            await executeCommand('demo.notify', o, Contract_0.demoNotifyContract, cmd.optsWithGlobals());
            process.exit(0);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(C.red + 'Error:' + C.reset, message);
            process.exit(1);
        }
    });
    ZodToCliMapper.applyOptions(cmd_demo_demoNotifyContract_notify, Contract_0.demoNotifyContract.inputSchema);
    const cmd_demo_demoCrud_create_create = demo.command('create').description(`CRUD create for demo (demoCrud)`);
    cmd_demo_demoCrud_create_create.action(async (o: Record<string, unknown>, cmd: Command) => {
        try {
            await executeCommand('demo.create', o, Contract_0.demoCrud['create'], cmd.optsWithGlobals());
            process.exit(0);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(C.red + 'Error:' + C.reset, message);
            process.exit(1);
        }
    });
    ZodToCliMapper.applyOptions(cmd_demo_demoCrud_create_create, Contract_0.demoCrud['create'].inputSchema);
    const cmd_demo_demoCrud_find_find = demo.command('find').description(`CRUD find for demo (demoCrud)`);
    cmd_demo_demoCrud_find_find.action(async (o: Record<string, unknown>, cmd: Command) => {
        try {
            await executeCommand('demo.find', o, Contract_0.demoCrud['find'], cmd.optsWithGlobals());
            process.exit(0);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(C.red + 'Error:' + C.reset, message);
            process.exit(1);
        }
    });
    ZodToCliMapper.applyOptions(cmd_demo_demoCrud_find_find, Contract_0.demoCrud['find'].inputSchema);
    const cmd_demo_demoCrud_findOne_find_one = demo.command('find_one').description(`CRUD findOne for demo (demoCrud)`);
    cmd_demo_demoCrud_findOne_find_one.action(async (o: Record<string, unknown>, cmd: Command) => {
        try {
            await executeCommand('demo.find_one', o, Contract_0.demoCrud['findOne'], cmd.optsWithGlobals());
            process.exit(0);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(C.red + 'Error:' + C.reset, message);
            process.exit(1);
        }
    });
    ZodToCliMapper.applyOptions(cmd_demo_demoCrud_findOne_find_one, Contract_0.demoCrud['findOne'].inputSchema);
    const cmd_demo_demoCrud_count_count = demo.command('count').description(`CRUD count for demo (demoCrud)`);
    cmd_demo_demoCrud_count_count.action(async (o: Record<string, unknown>, cmd: Command) => {
        try {
            await executeCommand('demo.count', o, Contract_0.demoCrud['count'], cmd.optsWithGlobals());
            process.exit(0);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(C.red + 'Error:' + C.reset, message);
            process.exit(1);
        }
    });
    ZodToCliMapper.applyOptions(cmd_demo_demoCrud_count_count, Contract_0.demoCrud['count'].inputSchema);
    const cmd_demo_demoCrud_get_get = demo.command('get').description(`CRUD get for demo (demoCrud)`);
    cmd_demo_demoCrud_get_get.action(async (o: Record<string, unknown>, cmd: Command) => {
        try {
            await executeCommand('demo.get', o, Contract_0.demoCrud['get'], cmd.optsWithGlobals());
            process.exit(0);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(C.red + 'Error:' + C.reset, message);
            process.exit(1);
        }
    });
    ZodToCliMapper.applyOptions(cmd_demo_demoCrud_get_get, Contract_0.demoCrud['get'].inputSchema);
    const cmd_demo_demoCrud_update_update = demo.command('update').description(`CRUD update for demo (demoCrud)`);
    cmd_demo_demoCrud_update_update.action(async (o: Record<string, unknown>, cmd: Command) => {
        try {
            await executeCommand('demo.update', o, Contract_0.demoCrud['update'], cmd.optsWithGlobals());
            process.exit(0);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(C.red + 'Error:' + C.reset, message);
            process.exit(1);
        }
    });
    ZodToCliMapper.applyOptions(cmd_demo_demoCrud_update_update, Contract_0.demoCrud['update'].inputSchema);
    const cmd_demo_demoCrud_delete_delete = demo.command('delete').description(`CRUD delete for demo (demoCrud)`);
    cmd_demo_demoCrud_delete_delete.action(async (o: Record<string, unknown>, cmd: Command) => {
        try {
            await executeCommand('demo.delete', o, Contract_0.demoCrud['delete'], cmd.optsWithGlobals());
            process.exit(0);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(C.red + 'Error:' + C.reset, message);
            process.exit(1);
        }
    });
    ZodToCliMapper.applyOptions(cmd_demo_demoCrud_delete_delete, Contract_0.demoCrud['delete'].inputSchema);
}
