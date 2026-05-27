import type { IMeshApp } from '../interfaces/IMeshApp.js';
import type { IMeshModule } from '../interfaces/IMeshModule.js';
import type { ILogger } from '../interfaces/ILogger.js';
import type { IServiceBroker } from '../interfaces/IServiceBroker.js';
import { MeshError } from './MeshError.js';

/**
 * BootOrchestrator — manages the multi-phase boot sequence of the MeshApp.
 */
export class BootOrchestrator {
    constructor(private app: IMeshApp) { }

    public async executeBootSequence(modules: IMeshModule[]): Promise<void> {
        this.checkCircularDependencies(modules);
        this.printBootGraph(modules);

        const logger = this.app.logger;
        let broker: IServiceBroker | undefined;
        
        try {
            // Phase 1: Initialization (Instantiation and configuration)
            for (const mod of modules) {
                this.app.logger.info(`[Orchestrator] Initializing module: ${mod.name}`);

                // Inject kernel dependencies
                mod.logger = logger;

                // Try to get broker if still missing
                if (!broker && this.app.hasProvider('broker')) {
                    broker = this.app.getProvider<IServiceBroker>('broker');
                }

                if (broker) {
                    mod.serviceBroker = broker;
                }

                if (mod.onInit) {
                    await mod.onInit(this.app);
                }

                // If broker was registered during mod.onInit, capture it for subsequent modules
                if (!broker && this.app.hasProvider('broker')) {
                    broker = this.app.getProvider<IServiceBroker>('broker');
                }
            }

            // Phase 2: Start (Starting operations)
            for (const mod of modules) {
                this.app.logger.info(`[Orchestrator] Starting module: ${mod.name}`);
                if (mod.onStart) {
                    await mod.onStart(this.app);
                }
            }

            // Phase 3: Ready (Final state)
            for (const mod of modules) {
                if (mod.onReady) {
                    await mod.onReady(this.app);
                }
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.app.logger.error(`[BootOrchestrator] Boot sequence aborted due to error:`, { error: err.message });
            throw err;
        }
    }

    private checkCircularDependencies(modules: IMeshModule[]): void {
        const visited = new Set<string>();
        const stack = new Set<string>();
        const moduleMap = new Map<string, IMeshModule>();

        for (const mod of modules) {
            moduleMap.set(mod.name, mod);
        }

        const visit = (name: string) => {
            if (stack.has(name)) {
                throw new MeshError({
                    message: `Circular dependency detected: ${Array.from(stack).join(' -> ')} -> ${name}`,
                    code: 'CIRCULAR_DEPENDENCY',
                    status: 500
                });
            }
            if (visited.has(name)) return;

            visited.add(name);
            stack.add(name);

            const mod = moduleMap.get(name);
            if (mod && mod.dependencies) {
                for (const dep of mod.dependencies) {
                    visit(dep);
                }
            }

            stack.delete(name);
        };

        for (const mod of modules) {
            visit(mod.name);
        }
    }

    private printBootGraph(modules: IMeshModule[]): void {
        this.app.logger.info('\n--- 🚀 MeshApp Boot Graph ---');
        modules.forEach((mod, i) => {
            const prefix = i === modules.length - 1 ? '└──' : '├──';
            this.app.logger.info(`${prefix} [${mod.name}]`);
        });
        this.app.logger.info('-----------------------------\n');
    }

    public async executeTeardown(modules: IMeshModule[]): Promise<void> {
        // Stop in reverse order
        for (const mod of [...modules].reverse()) {
            if (mod.onStop) {
                await mod.onStop(this.app);
            }
        }
    }
}
