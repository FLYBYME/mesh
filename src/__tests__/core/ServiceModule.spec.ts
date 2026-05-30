import { z } from 'zod';
import { DemoSkill } from '../../examples/demo/demo.service.js';
import { ServiceModule } from '../../core/ServiceModule.js';
import { defineContract, defaultPrint } from '../../interfaces/IToolContract.js';
import { defineCrud } from '../../interfaces/ICrudContract.js';
import type { IServiceContext } from '../../interfaces/IServiceContext.js';

describe('ServiceModule', () => {
    // ─── mountTool / getContracts ────────────────────────────────────────────

    describe('mountTool / getContracts', () => {
        it('should register tools and return their contracts', () => {
            const demoSkill = new DemoSkill();
            const contracts = demoSkill.getContracts();
            expect(contracts.length).toBeGreaterThan(0);

            const helloContract = contracts.find(c => c.action === 'hello');
            expect(helloContract).toBeDefined();
            expect(helloContract!.domain).toBe('demo');
        });

        it('should include CRUD contracts from mountCrud', () => {
            const demoSkill = new DemoSkill();
            const contracts = demoSkill.getContracts();

            const crudActions = ['find', 'find_one', 'count', 'get', 'create', 'create_many', 'update', 'replace', 'delete', 'resolve'];
            for (const action of crudActions) {
                const contract = contracts.find(c => c.action === action && c.domain === 'demo');
                expect(contract).toBeDefined();
            }
        });
    });

    // ─── execute ─────────────────────────────────────────────────────────────

    describe('execute()', () => {
        it('should dispatch to the correct handler', async () => {
            const demoSkill = new DemoSkill();
            const ctx = {
                correlationId: 'test-123',
                nodeID: 'test-node',
                call: async () => {},
                emit: () => {},
                logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
            } as unknown as IServiceContext;

            const result = await demoSkill.execute('demo', 'hello', { name: 'Execute' }, ctx);
            expect((result as Record<string, unknown>).message).toBe('Hello, Execute! Event dispatched!');
        });

        it('should throw for unknown action', async () => {
            const demoSkill = new DemoSkill();
            const ctx = {} as IServiceContext;

            await expect(
                demoSkill.execute('demo', 'nonexistent', {}, ctx)
            ).rejects.toThrow('No handler');
        });
    });

    // ─── isCrud ──────────────────────────────────────────────────────────────

    describe('isCrud()', () => {
        it('should return true for CRUD actions', () => {
            const demoSkill = new DemoSkill();
            expect(demoSkill.isCrud('demo', 'find')).toBe(true);
            expect(demoSkill.isCrud('demo', 'create')).toBe(true);
        });

        it('should return false for custom actions', () => {
            const demoSkill = new DemoSkill();
            expect(demoSkill.isCrud('demo', 'hello')).toBe(false);
        });
    });

    // ─── CRUD hooks ─────────────────────────────────────────────────────────

    describe('beforeCrud / afterCrud', () => {
        it('should pass through input when no hooks are registered', async () => {
            const demoSkill = new DemoSkill();
            const ctx = {} as IServiceContext;
            const input = { name: 'Test', value: 1 };
            const result = await demoSkill.beforeCrud('demo', 'create', input, ctx);
            expect(result).toEqual(input);
        });

        it('should pass through output when no hooks are registered', async () => {
            const demoSkill = new DemoSkill();
            const ctx = {} as IServiceContext;
            const output = { id: '123', name: 'Test' };
            const result = await demoSkill.afterCrud('demo', 'create', output, ctx);
            expect(result).toEqual(output);
        });

        it('should execute before/after hooks when registered', async () => {
            // Create a custom module with hooks
            class HookedService extends ServiceModule {
                public readonly domain = 'hooked';

                constructor() {
                    super();
                    const schema = z.object({ name: z.string() });
                    const crud = defineCrud('hooked', schema);
                    this.mountCrud(crud);

                    this.mountCrudHook('hooked', 'create', {
                        before: async (input) => {
                            const data = input as Record<string, unknown>;
                            return { ...data, name: `hooked-${data.name}` };
                        },
                        after: async (output) => {
                            const data = output as Record<string, unknown>;
                            return { ...data, hooked: true };
                        }
                    });
                }
            }

            const service = new HookedService();
            const ctx = {} as IServiceContext;

            const beforeResult = await service.beforeCrud('hooked', 'create', { name: 'test' }, ctx);
            expect((beforeResult as Record<string, unknown>).name).toBe('hooked-test');

            const afterResult = await service.afterCrud('hooked', 'create', { id: '1', name: 'test' }, ctx);
            expect((afterResult as Record<string, unknown>).hooked).toBe(true);
        });
    });

    // ─── event handlers ─────────────────────────────────────────────────────

    describe('getEventHandlers()', () => {
        it('should return registered event handlers', () => {
            const demoSkill = new DemoSkill();
            const handlers = demoSkill.getEventHandlers();
            expect(handlers.size).toBeGreaterThan(0);
            expect(handlers.has('demo.hello.sent')).toBe(true);
            expect(handlers.has('data.created')).toBe(true);
        });
    });
});
