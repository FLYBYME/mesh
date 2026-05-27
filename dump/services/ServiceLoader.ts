import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { IServiceModule } from './ServiceModule';
import { ServiceModuleRegistry } from './ServiceModuleRegistry';
import { IMeshApi } from './api';

/**
 * ServiceLoader: Dynamically discovers and loads services in-process.
 */
export class ServiceLoader<TApi extends IMeshApi = IMeshApi> {
    constructor(private registry: ServiceModuleRegistry<TApi>) {}

    /**
     * loadFromDirectory: Scans a directory for .service.ts files and registers them.
     */
    public async loadFromDirectory(dir: string): Promise<void> {
        if (!fs.existsSync(dir)) {
            console.warn(`[ServiceLoader] Directory "${dir}" not found. No services loaded.`);
            return;
        }

        const files = this.walkDir(dir).filter(f => f.endsWith('.service.ts'));

        for (const file of files) {
            try {
                const fileUrl = pathToFileURL(path.resolve(file)).href;
                const serviceModule = await import(fileUrl) as Record<string, unknown>;

                const ServiceClass = Object.values(serviceModule).find((v): v is new () => IServiceModule<TApi> =>
                    typeof v === 'function' && v.prototype && typeof v.prototype.execute === 'function'
                );

                if (!ServiceClass) {
                    throw new Error(`No valid Service class implementing IServiceModule found in ${file}`);
                }

                const serviceInstance = new ServiceClass();

                // Register for the primary domain
                this.registry.register(serviceInstance);

                // Register for all additional domains found in contracts
                const contracts = serviceInstance.getContracts();
                const domains = new Set(contracts.map(c => c.domain));
                for (const d of domains) {
                    if (d !== serviceInstance.domain) {
                        this.registry.registerByDomain(d, serviceInstance);
                    }
                }

                console.log(`[ServiceLoader] Registered service in-process: ${serviceInstance.domain} (domains: ${Array.from(domains).join(', ')})`);
            } catch (err) {
                console.error(`[ServiceLoader] Failed to load service from ${file}:`, String(err));
            }
        }
    }

    private walkDir(dir: string): string[] {
        let results: string[] = [];
        const list = fs.readdirSync(dir);
        list.forEach((file) => {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            if (stat && stat.isDirectory()) {
                results = results.concat(this.walkDir(filePath));
            } else {
                results.push(filePath);
            }
        });
        return results;
    }
}
