import { ServiceModule } from '../../core/ServiceModule.js';
import { demoHelloContract, demoStatusContract, demoNotifyContract, demoCrud } from './demo.contract.js';
import { demo_hello, demo_status, demo_notify } from './demo.tools.js';

/**
 * DemoSkill: A simple skill to verify the new Headless Engine architecture.
 * 
 * Demonstrates:
 * 1. Extension of ServiceModule.
 * 2. Strict typing of handlers.
 * 3. Use of mountCrud for automated persistence routing.
 * 4. Use of mountEventHandler for declarative event handling.
 */
export class DemoSkill extends ServiceModule {
    public readonly domain = 'demo';

    constructor() {
        super();

        // 1. Mount custom tools
        this.mountTool(demoHelloContract, demo_hello);
        this.mountTool(demoStatusContract, demo_status);
        this.mountTool(demoNotifyContract, demo_notify);

        // 2. Mount CRUD (Automated interception)
        this.mountCrud(demoCrud);

        // 3. Mount Event Handlers (Declarative)
        this.mountEventHandler('demo.hello.sent', (payload) => {
            // Logged via context in a real app, silenced for clean tests
        });

        this.mountEventHandler('data.created', (payload) => {
            if (payload.domain === this.domain) {
                // Logged via context in a real app, silenced for clean tests
            }
        });
    }
}
