import { z } from 'zod';
import { ServiceModule } from '../../../core/ServiceModule.js';
import { defineContract, defaultPrint } from '../../../interfaces/IToolContract.js';

const pingContract = defineContract({
    domain: 'sup-alpha',
    action: 'ping',
    description: 'Supervisor test fixture -- returns a per-instance random id, so tests can prove a restart really created a new instance.',
    inputSchema: z.object({}),
    outputSchema: z.object({ instanceId: z.string() }),
    rest: { method: 'GET', path: '/sup-alpha/ping' },
    print: defaultPrint,
});

export class AlphaService extends ServiceModule {
    public readonly domain = 'sup-alpha';
    public readonly instanceId = Math.random().toString(36).slice(2);
    public stopped = false;

    constructor() {
        super();
        this.mountTool(pingContract, async () => ({ instanceId: this.instanceId }));
    }

    public async onStop(): Promise<void> {
        this.stopped = true;
    }
}

export default AlphaService;
