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
import * as Contract_0 from '../../../../mesh-ui/src/services/uiservice/ui.contract.js';

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
        await new Promise(r => setTimeout(r, 2000)); // wait for registry sync (PEX)
    }

    try {
        console.log(C.dim + `Executing ${toolName}...` + C.reset);
        const res = await app.call(toolName as any, ZodToCliMapper.parseOptions(args, contract.inputSchema) as any, { timeout: 300000 });
        console.log(contract.print(res));
    } finally {
        await app.stop();
    }
}

export function registerGeneratedCommands(program: Command) {
    const ui = program.command('ui').description('ui tools');
    const cmd_ui_uiStatusContract_get_status = ui.command('get_status').description(`Retrieve the current health and build status of the UI service.`);
    cmd_ui_uiStatusContract_get_status.action(async (o: Record<string, unknown>, cmd: Command) => {
        try {
            await executeCommand('ui.get_status', o, Contract_0.uiStatusContract, cmd.optsWithGlobals());
            process.exit(0);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(C.red + 'Error:' + C.reset, message);
            process.exit(1);
        }
    });
    ZodToCliMapper.applyOptions(cmd_ui_uiStatusContract_get_status, Contract_0.uiStatusContract.inputSchema);
    const cmd_ui_uiBuildContract_build = ui.command('build').description(`Trigger a fresh build for a UI manifest.`);
    cmd_ui_uiBuildContract_build.action(async (o: Record<string, unknown>, cmd: Command) => {
        try {
            await executeCommand('ui.build', o, Contract_0.uiBuildContract, cmd.optsWithGlobals());
            process.exit(0);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(C.red + 'Error:' + C.reset, message);
            process.exit(1);
        }
    });
    ZodToCliMapper.applyOptions(cmd_ui_uiBuildContract_build, Contract_0.uiBuildContract.inputSchema);
    const uimanifest = program.command('uimanifest').description('uimanifest tools');
    const cmd_uimanifest_uiManifestCrud_create_create = uimanifest.command('create').description(`CRUD create for uimanifest (uiManifestCrud)`);
    cmd_uimanifest_uiManifestCrud_create_create.action(async (o: Record<string, unknown>, cmd: Command) => {
        try {
            await executeCommand('uimanifest.create', o, Contract_0.uiManifestCrud['create'], cmd.optsWithGlobals());
            process.exit(0);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(C.red + 'Error:' + C.reset, message);
            process.exit(1);
        }
    });
    ZodToCliMapper.applyOptions(cmd_uimanifest_uiManifestCrud_create_create, Contract_0.uiManifestCrud['create'].inputSchema);
    const cmd_uimanifest_uiManifestCrud_find_find = uimanifest.command('find').description(`CRUD find for uimanifest (uiManifestCrud)`);
    cmd_uimanifest_uiManifestCrud_find_find.action(async (o: Record<string, unknown>, cmd: Command) => {
        try {
            await executeCommand('uimanifest.find', o, Contract_0.uiManifestCrud['find'], cmd.optsWithGlobals());
            process.exit(0);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(C.red + 'Error:' + C.reset, message);
            process.exit(1);
        }
    });
    ZodToCliMapper.applyOptions(cmd_uimanifest_uiManifestCrud_find_find, Contract_0.uiManifestCrud['find'].inputSchema);
    const cmd_uimanifest_uiManifestCrud_findOne_find_one = uimanifest.command('find_one').description(`CRUD findOne for uimanifest (uiManifestCrud)`);
    cmd_uimanifest_uiManifestCrud_findOne_find_one.action(async (o: Record<string, unknown>, cmd: Command) => {
        try {
            await executeCommand('uimanifest.find_one', o, Contract_0.uiManifestCrud['findOne'], cmd.optsWithGlobals());
            process.exit(0);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(C.red + 'Error:' + C.reset, message);
            process.exit(1);
        }
    });
    ZodToCliMapper.applyOptions(cmd_uimanifest_uiManifestCrud_findOne_find_one, Contract_0.uiManifestCrud['findOne'].inputSchema);
    const cmd_uimanifest_uiManifestCrud_count_count = uimanifest.command('count').description(`CRUD count for uimanifest (uiManifestCrud)`);
    cmd_uimanifest_uiManifestCrud_count_count.action(async (o: Record<string, unknown>, cmd: Command) => {
        try {
            await executeCommand('uimanifest.count', o, Contract_0.uiManifestCrud['count'], cmd.optsWithGlobals());
            process.exit(0);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(C.red + 'Error:' + C.reset, message);
            process.exit(1);
        }
    });
    ZodToCliMapper.applyOptions(cmd_uimanifest_uiManifestCrud_count_count, Contract_0.uiManifestCrud['count'].inputSchema);
    const cmd_uimanifest_uiManifestCrud_get_get = uimanifest.command('get').description(`CRUD get for uimanifest (uiManifestCrud)`);
    cmd_uimanifest_uiManifestCrud_get_get.action(async (o: Record<string, unknown>, cmd: Command) => {
        try {
            await executeCommand('uimanifest.get', o, Contract_0.uiManifestCrud['get'], cmd.optsWithGlobals());
            process.exit(0);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(C.red + 'Error:' + C.reset, message);
            process.exit(1);
        }
    });
    ZodToCliMapper.applyOptions(cmd_uimanifest_uiManifestCrud_get_get, Contract_0.uiManifestCrud['get'].inputSchema);
    const cmd_uimanifest_uiManifestCrud_update_update = uimanifest.command('update').description(`CRUD update for uimanifest (uiManifestCrud)`);
    cmd_uimanifest_uiManifestCrud_update_update.action(async (o: Record<string, unknown>, cmd: Command) => {
        try {
            await executeCommand('uimanifest.update', o, Contract_0.uiManifestCrud['update'], cmd.optsWithGlobals());
            process.exit(0);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(C.red + 'Error:' + C.reset, message);
            process.exit(1);
        }
    });
    ZodToCliMapper.applyOptions(cmd_uimanifest_uiManifestCrud_update_update, Contract_0.uiManifestCrud['update'].inputSchema);
    const cmd_uimanifest_uiManifestCrud_delete_delete = uimanifest.command('delete').description(`CRUD delete for uimanifest (uiManifestCrud)`);
    cmd_uimanifest_uiManifestCrud_delete_delete.action(async (o: Record<string, unknown>, cmd: Command) => {
        try {
            await executeCommand('uimanifest.delete', o, Contract_0.uiManifestCrud['delete'], cmd.optsWithGlobals());
            process.exit(0);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(C.red + 'Error:' + C.reset, message);
            process.exit(1);
        }
    });
    ZodToCliMapper.applyOptions(cmd_uimanifest_uiManifestCrud_delete_delete, Contract_0.uiManifestCrud['delete'].inputSchema);
    const uiartifact = program.command('uiartifact').description('uiartifact tools');
    const cmd_uiartifact_uiArtifactCrud_create_create = uiartifact.command('create').description(`CRUD create for uiartifact (uiArtifactCrud)`);
    cmd_uiartifact_uiArtifactCrud_create_create.action(async (o: Record<string, unknown>, cmd: Command) => {
        try {
            await executeCommand('uiartifact.create', o, Contract_0.uiArtifactCrud['create'], cmd.optsWithGlobals());
            process.exit(0);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(C.red + 'Error:' + C.reset, message);
            process.exit(1);
        }
    });
    ZodToCliMapper.applyOptions(cmd_uiartifact_uiArtifactCrud_create_create, Contract_0.uiArtifactCrud['create'].inputSchema);
    const cmd_uiartifact_uiArtifactCrud_find_find = uiartifact.command('find').description(`CRUD find for uiartifact (uiArtifactCrud)`);
    cmd_uiartifact_uiArtifactCrud_find_find.action(async (o: Record<string, unknown>, cmd: Command) => {
        try {
            await executeCommand('uiartifact.find', o, Contract_0.uiArtifactCrud['find'], cmd.optsWithGlobals());
            process.exit(0);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(C.red + 'Error:' + C.reset, message);
            process.exit(1);
        }
    });
    ZodToCliMapper.applyOptions(cmd_uiartifact_uiArtifactCrud_find_find, Contract_0.uiArtifactCrud['find'].inputSchema);
    const cmd_uiartifact_uiArtifactCrud_findOne_find_one = uiartifact.command('find_one').description(`CRUD findOne for uiartifact (uiArtifactCrud)`);
    cmd_uiartifact_uiArtifactCrud_findOne_find_one.action(async (o: Record<string, unknown>, cmd: Command) => {
        try {
            await executeCommand('uiartifact.find_one', o, Contract_0.uiArtifactCrud['findOne'], cmd.optsWithGlobals());
            process.exit(0);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(C.red + 'Error:' + C.reset, message);
            process.exit(1);
        }
    });
    ZodToCliMapper.applyOptions(cmd_uiartifact_uiArtifactCrud_findOne_find_one, Contract_0.uiArtifactCrud['findOne'].inputSchema);
    const cmd_uiartifact_uiArtifactCrud_count_count = uiartifact.command('count').description(`CRUD count for uiartifact (uiArtifactCrud)`);
    cmd_uiartifact_uiArtifactCrud_count_count.action(async (o: Record<string, unknown>, cmd: Command) => {
        try {
            await executeCommand('uiartifact.count', o, Contract_0.uiArtifactCrud['count'], cmd.optsWithGlobals());
            process.exit(0);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(C.red + 'Error:' + C.reset, message);
            process.exit(1);
        }
    });
    ZodToCliMapper.applyOptions(cmd_uiartifact_uiArtifactCrud_count_count, Contract_0.uiArtifactCrud['count'].inputSchema);
    const cmd_uiartifact_uiArtifactCrud_get_get = uiartifact.command('get').description(`CRUD get for uiartifact (uiArtifactCrud)`);
    cmd_uiartifact_uiArtifactCrud_get_get.action(async (o: Record<string, unknown>, cmd: Command) => {
        try {
            await executeCommand('uiartifact.get', o, Contract_0.uiArtifactCrud['get'], cmd.optsWithGlobals());
            process.exit(0);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(C.red + 'Error:' + C.reset, message);
            process.exit(1);
        }
    });
    ZodToCliMapper.applyOptions(cmd_uiartifact_uiArtifactCrud_get_get, Contract_0.uiArtifactCrud['get'].inputSchema);
    const cmd_uiartifact_uiArtifactCrud_update_update = uiartifact.command('update').description(`CRUD update for uiartifact (uiArtifactCrud)`);
    cmd_uiartifact_uiArtifactCrud_update_update.action(async (o: Record<string, unknown>, cmd: Command) => {
        try {
            await executeCommand('uiartifact.update', o, Contract_0.uiArtifactCrud['update'], cmd.optsWithGlobals());
            process.exit(0);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(C.red + 'Error:' + C.reset, message);
            process.exit(1);
        }
    });
    ZodToCliMapper.applyOptions(cmd_uiartifact_uiArtifactCrud_update_update, Contract_0.uiArtifactCrud['update'].inputSchema);
    const cmd_uiartifact_uiArtifactCrud_delete_delete = uiartifact.command('delete').description(`CRUD delete for uiartifact (uiArtifactCrud)`);
    cmd_uiartifact_uiArtifactCrud_delete_delete.action(async (o: Record<string, unknown>, cmd: Command) => {
        try {
            await executeCommand('uiartifact.delete', o, Contract_0.uiArtifactCrud['delete'], cmd.optsWithGlobals());
            process.exit(0);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(C.red + 'Error:' + C.reset, message);
            process.exit(1);
        }
    });
    ZodToCliMapper.applyOptions(cmd_uiartifact_uiArtifactCrud_delete_delete, Contract_0.uiArtifactCrud['delete'].inputSchema);
}
