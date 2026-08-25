import { z } from 'zod';
import { ServiceModule } from '../../../core/ServiceModule.js';
import { defineContract, defaultPrint } from '../../../interfaces/IToolContract.js';

const pingContract = defineContract({
    domain: 'sup-beta',
    action: 'ping',
    description: 'Supervisor test fixture -- depends on sup-alpha in the manifest.',
    inputSchema: z.object({}),
    outputSchema: z.object({ ok: z.boolean() }),
    rest: { method: 'GET', path: '/sup-beta/ping' },
    print: defaultPrint,
});

export class BetaService extends ServiceModule {
    public readonly domain = 'sup-beta';

    constructor() {
        super();
        this.mountTool(pingContract, async () => ({ ok: true }));
    }
}

export default BetaService;
