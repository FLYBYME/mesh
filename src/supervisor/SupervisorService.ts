import { z } from 'zod';
import { ServiceModule } from '../core/ServiceModule.js';
import { defineContract, defaultPrint } from '../interfaces/IToolContract.js';
import type { Supervisor, SupervisorServiceStatus } from './Supervisor.js';

const statusSchema = z.object({
    name: z.string(),
    domain: z.string().optional(),
    status: z.enum(['stopped', 'running', 'error']),
    dependsOn: z.array(z.string()),
    error: z.string().optional(),
});

const serviceStartContract = defineContract({
    domain: 'supervisor',
    action: 'service_start',
    description: 'Starts one manifest-defined service by name, in this Supervisor process, if its dependencies are already running.',
    inputSchema: z.object({ name: z.string() }),
    outputSchema: statusSchema,
    rest: { method: 'POST', path: '/supervisor/service_start' },
    destructive: true,
    print: defaultPrint,
});

const serviceStopContract = defineContract({
    domain: 'supervisor',
    action: 'service_stop',
    description: 'Stops one running manifest-defined service by name. Fails if other running services still depend on it, unless cascade is set.',
    inputSchema: z.object({ name: z.string(), cascade: z.boolean().optional() }),
    outputSchema: statusSchema,
    rest: { method: 'POST', path: '/supervisor/service_stop' },
    destructive: true,
    print: defaultPrint,
});

const serviceRestartContract = defineContract({
    domain: 'supervisor',
    action: 'service_restart',
    description: 'Restarts one manifest-defined service by name: stops it, then starts a fresh instance.',
    inputSchema: z.object({ name: z.string() }),
    outputSchema: statusSchema,
    rest: { method: 'POST', path: '/supervisor/service_restart' },
    destructive: true,
    print: defaultPrint,
});

const serviceStatusContract = defineContract({
    domain: 'supervisor',
    action: 'service_status',
    description: 'Reports the current status of one (or, if name is omitted, every) manifest-defined service in this Supervisor process.',
    inputSchema: z.object({ name: z.string().optional() }),
    outputSchema: z.object({ services: z.array(statusSchema) }),
    rest: { method: 'GET', path: '/supervisor/service_status' },
    destructive: false,
    print: defaultPrint,
});

declare global {
    interface IServiceToolRegistry {
        'supervisor.service_start': { params: z.infer<typeof serviceStartContract.inputSchema>; returns: SupervisorServiceStatus };
        'supervisor.service_stop': { params: z.infer<typeof serviceStopContract.inputSchema>; returns: SupervisorServiceStatus };
        'supervisor.service_restart': { params: z.infer<typeof serviceRestartContract.inputSchema>; returns: SupervisorServiceStatus };
        'supervisor.service_status': { params: z.infer<typeof serviceStatusContract.inputSchema>; returns: { services: SupervisorServiceStatus[] } };
    }
}

/**
 * SupervisorService — exposes the Supervisor's control surface as real mesh
 * contracts, callable the same way anything else in the mesh is called.
 * Mounted specially, before the dynamic services it manages (see
 * docs/SUPERVISOR_AND_SERVICE_LIFECYCLE.md, Part 2 "Control surface").
 */
export class SupervisorService extends ServiceModule {
    public readonly domain = 'supervisor';

    constructor(supervisor: Supervisor) {
        super();

        this.mountTool(serviceStartContract, async (input) => supervisor.serviceStart(input.name));

        this.mountTool(serviceStopContract, async (input) =>
            supervisor.serviceStop(input.name, { cascade: input.cascade })
        );

        this.mountTool(serviceRestartContract, async (input) => supervisor.serviceRestart(input.name));

        this.mountTool(serviceStatusContract, async (input) => ({
            services: supervisor.serviceStatus(input.name),
        }));
    }
}

export default SupervisorService;
