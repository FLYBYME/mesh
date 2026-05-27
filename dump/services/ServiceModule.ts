import { z } from 'zod';
import { ToolContract } from '../contracts/tool_contract';
import { IMeshApi } from './api';
import { IEventBus, EventRegistry } from '../events/events';
import { AnyCrudContracts } from '../contracts/crud_contract';
import { IMeshModule } from '../interfaces/IMeshModule';
import { IMeshApp } from '../interfaces/IMeshApp';

import { Database } from '../engine/db/Database';

export interface IServiceModuleRegistry<TApi extends IMeshApi = IMeshApi> {
    getService(domain: string): IServiceModule<TApi> | undefined;
    getTool(toolName: string): Promise<ToolContract<z.ZodTypeAny, z.ZodTypeAny> | undefined>;
}

/**
 * IServiceContext: The strictly-typed execution context injected into every service.
 */
export interface IServiceContext<TApi extends IMeshApi = IMeshApi> {
    readonly api: TApi;
    readonly events: IEventBus;
    readonly services: IServiceModuleRegistry<TApi>;
    readonly db?: Database;
    readonly sandboxId?: string;
    readonly correlationId: string;
    readonly signal?: AbortSignal;
}

/**
 * ServiceActionHandler: The function signature for a tool's implementation.
 */
export type ServiceActionHandler<TInput, TOutput, TApi extends IMeshApi> = (
    args: TInput,
    context: IServiceContext<TApi>
) => Promise<TOutput> | AsyncIterable<TOutput>;

/**
 * EventHandler: Signature for a strictly-typed event subscriber.
 */
export type EventHandler<K extends keyof EventRegistry> = (
    payload: EventRegistry[K],
    correlationId: string
) => void | Promise<void>;

/**
 * IServiceModule: The interface every service must implement.
 */
export interface IServiceModule<TApi extends IMeshApi = IMeshApi> extends IMeshModule {
    readonly domain: string;
    getContracts(): ToolContract<z.ZodTypeAny, z.ZodTypeAny>[];
    execute<T>(domain: string, action: string, args: unknown, context: IServiceContext<TApi>): Promise<T>;
    executeStream<T>(domain: string, action: string, args: unknown, context: IServiceContext<TApi>): AsyncIterable<T>;
    postInit?(context: IServiceContext<TApi>): Promise<void>;
    isCrud(domain: string, action: string): boolean;
    getEventHandlers(): Map<keyof EventRegistry, EventHandler<keyof EventRegistry>>;

    // CRUD Hooks
    beforeCrud?(domain: string, action: string, input: unknown, context: IServiceContext<TApi>): Promise<unknown>;
    afterCrud?(domain: string, action: string, output: unknown, context: IServiceContext<TApi>): Promise<unknown>;
}

/**
 * BaseServiceModule: Abstract base class for all services.
 */
export abstract class BaseServiceModule<TApi extends IMeshApi = IMeshApi> implements IServiceModule<TApi> {
    public abstract readonly domain: string;
    
    get name(): string {
        return this.domain;
    }

    private eventHandlers: Map<keyof EventRegistry, EventHandler<keyof EventRegistry>> = new Map();

    protected handlers: Map<string, {
        contract: ToolContract<z.ZodTypeAny, z.ZodTypeAny>;
        handler: ServiceActionHandler<unknown, unknown, TApi>;
    }> = new Map();

    protected crudHooks: Map<string, {
        before?: (input: any, ctx: IServiceContext<TApi>) => Promise<any>;
        after?: (output: any, ctx: IServiceContext<TApi>) => Promise<any>;
    }> = new Map();

    public getContracts(): ToolContract<z.ZodTypeAny, z.ZodTypeAny>[] {
        return Array.from(this.handlers.values()).map(h => h.contract);
    }

    public async execute<T>(domain: string, action: string, args: unknown, context: IServiceContext<TApi>): Promise<T> {
        const binding = this.handlers.get(`${domain}:${action}`);
        if (!binding) {
            throw new Error(`Execution Error: Action '${action}' not found in domain '${domain}' of service '${this.domain}'.`);
        }

        const result = binding.handler(args, context);
        if (result instanceof Promise) {
            return await (result as Promise<T>);
        }

        throw new Error(`Execution Error: Action '${action}' in '${domain}' of service '${this.domain}' returned a stream.`);
    }

    public async *executeStream<T>(domain: string, action: string, args: unknown, context: IServiceContext<TApi>): AsyncIterable<T> {
        const binding = this.handlers.get(`${domain}:${action}`);
        if (!binding) {
            throw new Error(`Execution Error: Action '${action}' not found in domain '${domain}' of service '${this.domain}'.`);
        }

        const result = binding.handler(args, context);
        if (result instanceof Promise) {
            throw new Error(`Execution Error: Action '${action}' in '${domain}' of service '${this.domain}' returned a promise but was called as a stream.`);
        }

        yield* result as AsyncIterable<T>;
    }

    public isCrud(domain: string, action: string): boolean {
        const binding = this.handlers.get(`${domain}:${action}`);
        return !!binding?.contract.isCrud;
    }

    public getEventHandlers(): Map<keyof EventRegistry, EventHandler<keyof EventRegistry>> {
        return this.eventHandlers;
    }

    // --- CRUD Hooks Implementation ---

    public async beforeCrud(domain: string, action: string, input: unknown, context: IServiceContext<TApi>): Promise<unknown> {
        const hook = this.crudHooks.get(`${domain}:${action}`);
        if (hook?.before) {
            return await hook.before(input, context);
        }
        return input;
    }

    public async afterCrud(domain: string, action: string, output: unknown, context: IServiceContext<TApi>): Promise<unknown> {
        const hook = this.crudHooks.get(`${domain}:${action}`);
        if (hook?.after) {
            return await hook.after(output, context);
        }
        return output;
    }

    /**
     * mountCrudHook: Register before/after logic for a CRUD action.
     */
    protected mountCrudHook<TIn = any, TOut = any>(
        domain: string,
        action: string,
        hooks: {
            before?: (input: TIn, ctx: IServiceContext<TApi>) => Promise<TIn>;
            after?: (output: TOut, ctx: IServiceContext<TApi>) => Promise<TOut>;
        }
    ): void {
        this.crudHooks.set(`${domain}:${action}`, hooks);
    }

    /**
     * mountTool: Register a custom tool handler.
     */
    protected mountTool<TIn extends z.ZodTypeAny, TOut extends z.ZodTypeAny>(
        contract: ToolContract<TIn, TOut>,
        handler: ServiceActionHandler<z.infer<TIn>, z.infer<TOut>, TApi>
    ): void {
        this.handlers.set(`${contract.domain}:${contract.action}`, {
            contract: contract as unknown as ToolContract<z.ZodTypeAny, z.ZodTypeAny>,
            handler: handler as ServiceActionHandler<unknown, unknown, TApi>
        });
    }

    /**
     * mountCrud: Mounts standard persistence routing for a domain.
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

    /**
     * mountEventHandler: Declaratively register an event subscriber.
     */
    protected mountEventHandler<K extends keyof EventRegistry>(
        name: K,
        handler: EventHandler<K>
    ): void {
        this.eventHandlers.set(name, handler as EventHandler<keyof EventRegistry>);
    }
}
