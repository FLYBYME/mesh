import { z } from 'zod';
import type { ToolContract } from '../interfaces/IToolContract.js';
import type { IServiceModule } from '../interfaces/IServiceModule.js';
import type { AnyCrudContracts } from '../interfaces/ICrudContract.js';
import type { IServiceContext, ServiceActionHandler } from '../interfaces/IServiceContext.js';
import type { EventRegistry } from '../interfaces/IEventContract.js';

/**
 * EventHandler: Signature for a strictly-typed event subscriber.
 */
export type EventHandler<K extends keyof EventRegistry> = (
    payload: EventRegistry[K]
) => void | Promise<void>;

/**
 * ServiceModule — Abstract base class for defining a domain service.
 *
 * Provides `mountTool()`, `mountCrud()`, and `mountEventHandler()` for
 * declarative registration. Mirrors Castellan's BaseSkillModule.
 *
 * Usage:
 * ```typescript
 * export class DemoService extends ServiceModule {
 *     public readonly domain = 'demo';
 *
 *     constructor() {
 *         super();
 *         this.mountTool(demoHelloContract, demo_hello);
 *         this.mountCrud(demoCrud);
 *         this.mountEventHandler('data.created', (payload) => {
 *             if (payload.domain === this.domain) {
 *                 console.log(`New demo item: ${payload.id}`);
 *             }
 *         });
 *     }
 * }
 * ```
 */
export abstract class ServiceModule implements IServiceModule {
    public abstract readonly domain: string;

    private handlers = new Map<string, {
        contract: ToolContract<z.ZodTypeAny, z.ZodTypeAny>;
        handler: ServiceActionHandler<unknown, unknown>;
    }>();

    private crudHooks = new Map<string, {
        before?: (input: unknown, ctx: IServiceContext) => Promise<unknown>;
        after?: (output: unknown, ctx: IServiceContext) => Promise<unknown>;
    }>();

    private eventHandlerMap = new Map<keyof EventRegistry, EventHandler<keyof EventRegistry>>();

    // ─── Tool Registration ───────────────────────────────────────────────────

    /**
     * mountTool: Register a custom tool handler.
     */
    protected mountTool<TIn extends z.ZodTypeAny, TOut extends z.ZodTypeAny>(
        contract: ToolContract<TIn, TOut>,
        handler: ServiceActionHandler<z.infer<TIn>, z.infer<TOut>>
    ): void {
        this.handlers.set(`${contract.domain}.${contract.action}`, {
            contract: contract as unknown as ToolContract<z.ZodTypeAny, z.ZodTypeAny>,
            handler: handler as ServiceActionHandler<unknown, unknown>
        });
    }

    /**
     * mountCrud: Mounts standard persistence routing for a domain.
     * CRUD actions are intercepted by the engine's persistence layer.
     */
    protected mountCrud(contracts: AnyCrudContracts): void {
        const keys = ['create', 'find', 'findOne', 'get', 'update', 'delete', 'count', 'replace', 'resolve', 'createMany'] as const;
        for (const key of keys) {
            const contract = contracts[key];
            if (contract && typeof contract === 'object' && 'domain' in contract && 'action' in contract) {
                const tool = contract as ToolContract<z.ZodTypeAny, z.ZodTypeAny>;
                this.mountTool(tool, async () => {
                    throw new Error(`Engine Error: CRUD action "${tool.action}" for domain "${tool.domain}" was not intercepted.`);
                });
            }
        }
    }

    // ─── CRUD Hooks ──────────────────────────────────────────────────────────

    /**
     * mountCrudHook: Register before/after logic for a CRUD action.
     */
    protected mountCrudHook(
        domain: string,
        action: string,
        hooks: {
            before?: (input: unknown, ctx: IServiceContext) => Promise<unknown>;
            after?: (output: unknown, ctx: IServiceContext) => Promise<unknown>;
        }
    ): void {
        this.crudHooks.set(`${domain}.${action}`, hooks);
    }

    // ─── Event Registration ──────────────────────────────────────────────────

    /**
     * mountEventHandler: Declaratively register an event subscriber.
     * Subscriptions are activated automatically during engine boot.
     */
    protected mountEventHandler<K extends keyof EventRegistry>(
        name: K,
        handler: EventHandler<K>
    ): void {
        this.eventHandlerMap.set(name, handler as EventHandler<keyof EventRegistry>);
    }

    // ─── IServiceModule Implementation ───────────────────────────────────────

    public getContracts(): ToolContract<z.ZodTypeAny, z.ZodTypeAny>[] {
        return Array.from(this.handlers.values()).map(h => h.contract);
    }

    public async execute(domain: string, action: string, input: unknown, ctx: IServiceContext): Promise<unknown> {
        const key = `${domain}.${action}`;
        const entry = this.handlers.get(key);
        if (!entry) {
            throw new Error(`[ServiceModule] No handler for ${key} in domain '${this.domain}'.`);
        }
        return entry.handler(input, ctx);
    }

    public isCrud(domain: string, action: string): boolean {
        const entry = this.handlers.get(`${domain}.${action}`);
        return !!entry?.contract.isCrud;
    }

    public getEventHandlers(): Map<keyof EventRegistry, (payload: any) => void | Promise<void>> {
        return this.eventHandlerMap as Map<keyof EventRegistry, (payload: any) => void | Promise<void>>;
    }

    // ─── CRUD Hook Execution ─────────────────────────────────────────────────

    public async beforeCrud(domain: string, action: string, input: unknown, ctx: IServiceContext): Promise<unknown> {
        const hook = this.crudHooks.get(`${domain}.${action}`);
        if (hook?.before) {
            return await hook.before(input, ctx);
        }
        return input;
    }

    public async afterCrud(domain: string, action: string, output: unknown, ctx: IServiceContext): Promise<unknown> {
        const hook = this.crudHooks.get(`${domain}.${action}`);
        if (hook?.after) {
            return await hook.after(output, ctx);
        }
        return output;
    }
}
