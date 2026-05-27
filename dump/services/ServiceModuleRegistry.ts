import { ToolContract, parseToolKey } from '../contracts/tool_contract';
import { IMeshApi } from './api';
import { IServiceModule, IServiceModuleRegistry } from './ServiceModule';
import { z } from 'zod';

/**
 * ServiceModuleRegistry: A headless manager for all active service modules.
 */
export class ServiceModuleRegistry<TApi extends IMeshApi = IMeshApi> implements IServiceModuleRegistry<TApi> {
    private modules: Map<string, IServiceModule<TApi>> = new Map();

    /**
     * register: Adds a service to the platform.
     */
    public register(service: IServiceModule<TApi>): void {
        this.registerByDomain(service.domain, service);
    }

    /**
     * registerByDomain: Registers a service for a specific domain.
     */
    public registerByDomain(domain: string, service: IServiceModule<TApi>): void {
        if (this.modules.has(domain)) {
            const existing = this.modules.get(domain);
            if (existing !== service) {
                console.warn(`[ServiceModuleRegistry] Domain "${domain}" is already registered by another service. Overwriting.`);
            }
        }
        this.modules.set(domain, service);
    }

    /**
     * registerAll: Batch registration of multiple services.
     */
    public registerAll(services: IServiceModule<TApi>[]): void {
        for (const service of services) {
            this.register(service);
        }
    }

    public getService(domain: string): IServiceModule<TApi> | undefined {
        return this.modules.get(domain);
    }

    public allServices(): IServiceModule<TApi>[] {
        return Array.from(new Set(this.modules.values()));
    }

    public async getTool(toolName: string): Promise<ToolContract<z.ZodTypeAny, z.ZodTypeAny> | undefined> {
        const { domain, action } = parseToolKey(toolName);
        const service = this.getService(domain);
        if (!service) return undefined;
        return service.getContracts().find((tool) => tool.domain === domain && tool.action === action);
    }

    public clear(): void {
        this.modules.clear();
    }
}
