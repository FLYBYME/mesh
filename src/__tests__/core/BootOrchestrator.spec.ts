import { BootOrchestrator } from '../../core/BootOrchestrator.js';
import { MeshApp } from '../../core/MeshApp.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import type { IMeshModule } from '../../interfaces/index.js';

describe('BootOrchestrator', () => {
    let app: MeshApp;

    beforeEach(() => {
        app = new MeshApp({ nodeID: 'orchestrator-test', logger: new Logger(LogLevel.WARN) });
    });

    // ─── phase ordering ─────────────────────────────────────────────────────

    describe('executeBootSequence()', () => {
        it('should execute onInit → onStart → onReady in order', async () => {
            const phases: string[] = [];

            const testModule: IMeshModule = {
                name: 'phase-test',
                onInit: async () => { phases.push('init'); },
                onStart: async () => { phases.push('start'); },
                onReady: async () => { phases.push('ready'); },
            };

            app.use(new RegistryModule());
            app.use(new BrokerModule());

            const orchestrator = app.orchestrator;
            // We need registry+broker modules first for proper boot
            await orchestrator.executeBootSequence([
                new RegistryModule(),
                new BrokerModule(),
                testModule
            ]);

            expect(phases).toEqual(['init', 'start', 'ready']);
        });

        it('should inject logger into modules', async () => {
            let injectedLogger: unknown = null;

            const testModule: IMeshModule = {
                name: 'inject-test',
                onInit: async () => {
                    injectedLogger = testModule.logger;
                },
            };

            await app.orchestrator.executeBootSequence([testModule]);
            expect(injectedLogger).toBeDefined();
        });
    });

    // ─── circular dependency detection ──────────────────────────────────────

    describe('circular dependency detection', () => {
        it('should throw on circular dependencies', async () => {
            const modA: IMeshModule = {
                name: 'mod-a',
                dependencies: ['mod-b'],
            };
            const modB: IMeshModule = {
                name: 'mod-b',
                dependencies: ['mod-a'],
            };

            await expect(
                app.orchestrator.executeBootSequence([modA, modB])
            ).rejects.toThrow('Circular dependency');
        });

        it('should not throw for valid dependency chains', async () => {
            const modA: IMeshModule = { name: 'mod-a' };
            const modB: IMeshModule = { name: 'mod-b', dependencies: ['mod-a'] };

            await expect(
                app.orchestrator.executeBootSequence([modA, modB])
            ).resolves.not.toThrow();
        });
    });

    // ─── teardown ────────────────────────────────────────────────────────────

    describe('executeTeardown()', () => {
        it('should stop modules in reverse order', async () => {
            const order: string[] = [];

            const modA: IMeshModule = {
                name: 'teardown-a',
                onStop: async () => { order.push('a'); },
            };
            const modB: IMeshModule = {
                name: 'teardown-b',
                onStop: async () => { order.push('b'); },
            };

            await app.orchestrator.executeTeardown([modA, modB]);
            expect(order).toEqual(['b', 'a']);
        });
    });
});
