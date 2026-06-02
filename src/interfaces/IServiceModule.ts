import { z } from 'zod';
import type { ToolContract } from './IToolContract.js';
import type { IServiceContext } from './IServiceContext.js';
import type { IServiceBroker } from './IServiceBroker.js';

/**
 * IServiceModule: Interface for local service modules in the mesh.
 * Implemented by ServiceModule base class.
 */
export interface IServiceModule {
    readonly domain: string;
    onInit?(broker: IServiceBroker): Promise<void>;
    onStart?(broker: IServiceBroker): Promise<void>;
    onStop?(broker: IServiceBroker): Promise<void>;
    getContracts(): ToolContract<z.ZodTypeAny, z.ZodTypeAny>[];
    execute(domain: string, action: string, input: unknown, ctx: IServiceContext): Promise<unknown>;
    isCrud(domain: string, action: string): boolean;
    getEventHandlers(): Map<keyof EventRegistry, (payload: any, ctx: IServiceContext) => void | Promise<void>>;
    beforeCrud(domain: string, action: string, input: unknown, ctx: IServiceContext): Promise<unknown>;
    afterCrud(domain: string, action: string, output: unknown, ctx: IServiceContext): Promise<unknown>;
}
