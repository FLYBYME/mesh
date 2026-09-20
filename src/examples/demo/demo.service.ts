import type { IServiceBroker } from '../../interfaces/IServiceBroker.js';
import { demoHelloContract, demoStatusContract, demoNotifyContract, demoCrud, demoTimeSeries } from './demo.contract.js';
import { demo_hello, demo_status, demo_notify } from './demo.tools.js';

export const DEMO_DOMAIN = 'demo';

/**
 * The demo part: everything a service can be, with no class holding it together.
 *
 * A part is its contracts and the handlers they point at. There is no object to construct, nothing
 * to subclass, and no lifecycle to implement -- registering is the whole of it. Shows, in order:
 *
 * 1. custom contracts with strictly typed handlers
 * 2. a CRUD collection, whose actions `DatabaseMiddleware` intercepts before dispatch
 * 3. a time-series collection, same
 * 4. event handlers, declared the same way
 *
 * In a real part this function is not written by hand either: the contracts' own `filePath`
 * declarations are enough for `broker.loadDomain()` to do all of it. This one is explicit because
 * it is the example.
 */
export function register(broker: IServiceBroker): string {
    broker.registerContract(demoHelloContract, demo_hello);
    broker.registerContract(demoStatusContract, demo_status);
    broker.registerContract(demoNotifyContract, demo_notify);

    broker.registerCrud(demoCrud);
    broker.registerTimeSeries(demoTimeSeries);

    broker.registerEventHandler('demo.hello.sent', () => {
        // Logged via context in a real app, silenced for clean tests
    });

    broker.registerEventHandler('data.created', (payload) => {
        if (payload.domain === DEMO_DOMAIN) {
            // Logged via context in a real app, silenced for clean tests
        }
    });

    return DEMO_DOMAIN;
}
