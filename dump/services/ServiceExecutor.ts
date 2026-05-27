import { z } from 'zod';
import { IMeshApi } from './api';
import { IServiceContext } from './ServiceModule';
import { ServiceModuleRegistry } from './ServiceModuleRegistry';

/**
 * ServiceExecutor: The central execution pipeline of the Mesh Engine.
 */
export class ServiceExecutor<TApi extends IMeshApi = IMeshApi> {
    constructor(
        private registry: ServiceModuleRegistry<TApi>
    ) { }

    /**
     * execute: Performs the full tool execution lifecycle for standard tools.
     */
    public async execute<T>(
        domain: string,
        action: string,
        input: unknown,
        context: IServiceContext<TApi>
    ): Promise<T> {
        try {
            const service = this.registry.getService(domain);
            if (!service) throw new Error(`Execution Error: Domain "${domain}" not found.`);

            const contracts = service.getContracts();
            const contract = contracts.find(c => c.domain === domain && c.action === action);
            if (!contract) throw new Error(`Execution Error: Action "${action}" not found in domain "${domain}".`);

            // 1. Validation
            const validatedInput: unknown = contract.inputSchema
                ? contract.inputSchema.parse(input)
                : input;

            // 2. Intercept CRUD
            let result: any;
            if (service.isCrud(domain, action)) {
                result = await this.executeCrud(domain, action, validatedInput, contract, context);
            } else {
                // 3. Normal Execution
                result = await service.execute<T>(domain, action, validatedInput, context);
            }

            if (this.isAsyncIterable(result)) {
                throw new Error(`Execution Error: Action "${domain}_${action}" returned a stream but was called as a standard tool.`);
            }

            return result as T;
        } catch (err) {
            throw err;
        }
    }

    /**
     * executeStream: Variant for tools that return AsyncIterables.
     */
    public async *executeStream<T>(
        domain: string,
        action: string,
        input: unknown,
        context: IServiceContext<TApi>
    ): AsyncIterable<T> {
        const service = this.registry.getService(domain);
        if (!service) throw new Error(`Execution Error: Domain "${domain}" not found.`);

        const result = service.executeStream<T>(domain, action, input, context);

        for await (const chunk of result) {
            yield chunk;
        }
    }

    private async executeCrud(
        domain: string,
        action: string,
        input: unknown,
        contract: { outputSchema: z.ZodTypeAny },
        context: IServiceContext<TApi>
    ): Promise<unknown> {
        const service = this.registry.getService(domain);
        if (!service) throw new Error(`Execution Error: Domain "${domain}" not found.`);

        if (!this.isRecord(input)) {
            throw new Error(`Execution Error: CRUD input for ${domain}:${action} must be an object.`);
        }

        // 1. Before Hook
        let effectiveInput = input;
        if (service.beforeCrud) {
            effectiveInput = await service.beforeCrud(domain, action, input, context) as Record<string, unknown>;
        }

        // CRUD execution would be handled by a database layer when integrated.
        // For now, delegate back to the service module's handler.
        let result = await service.execute(domain, action, effectiveInput, context);

        // 2. After Hook
        if (service.afterCrud) {
            result = await service.afterCrud(domain, action, result, context);
        }

        return result;
    }

    private isAsyncIterable(obj: unknown): obj is AsyncIterable<unknown> {
        return (
            typeof obj === 'object' &&
            obj !== null &&
            Symbol.asyncIterator in obj
        );
    }

    private isRecord(obj: unknown): obj is Record<string, unknown> {
        return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
    }
}
