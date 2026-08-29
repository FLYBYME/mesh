import { z } from 'zod';
import { MeshApp } from '../../core/MeshApp.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { ServiceModule } from '../../core/ServiceModule.js';
import { MeshError, ClientError } from '../../core/MeshError.js';
import { defineContract, defaultPrint } from '../../interfaces/IToolContract.js';
import type { IServiceBroker } from '../../interfaces/IServiceBroker.js';

// No DatabaseModule: params validation happens before any persistence concern, so this suite runs
// without Mongo and stays runnable in environments where MONGODB_URI is not configured.
//
// The `as never` casts below are deliberate and are the one honest use of a cast: the point of
// these tests is to pass params the contract rejects, and a correctly typed call cannot express
// that. Every other cast in this codebase is a bug.

const greetContract = defineContract({
    domain: 'validationdemo',
    action: 'greet',
    description: 'Greets someone by name',
    inputSchema: z.object({ name: z.string(), times: z.number().optional() }),
    outputSchema: z.object({ greeting: z.string() }),
    rest: { method: 'POST', path: '/validationdemo/greet' },
    print: defaultPrint,
});

class ValidationDemoService extends ServiceModule {
    public readonly domain = 'validationdemo';

    constructor() {
        super();
        this.mountTool(greetContract, async (input) => ({ greeting: `hello ${input.name}` }));
    }
}

describe('ServiceBroker — params validation failures are client errors', () => {
    let app: MeshApp;
    let broker: IServiceBroker;

    beforeAll(async () => {
        app = new MeshApp({ nodeID: 'params-validation-node', namespace: 'test' });
        app.use(new RegistryModule({ preferLocal: true }));
        app.use(new BrokerModule());
        await app.start();
        await app.registerModule(new ValidationDemoService());
        broker = app.getProvider<IServiceBroker>('broker');
    });

    afterAll(async () => {
        await app.stop();
    });

    it('throws ClientError with status 400, not a bare Error', async () => {
        // A caller passing params the contract rejects is a client error. Thrown as a plain
        // `Error` it carried no status, so every transport mapping mesh errors outward -- an HTTP
        // gateway, the CLI -- had to report a caller's typo as a 500.
        expect.assertions(4);
        try {
            await broker.call('validationdemo.greet', { name: 123 } as never);
        } catch (err) {
            expect(err).toBeInstanceOf(ClientError);
            expect(err).toBeInstanceOf(MeshError);
            expect((err as ClientError).status).toBe(400);
            expect((err as ClientError).code).toBe('INVALID_PARAMS');
        }
    });

    it('names the offending field instead of dumping the raw ZodError', async () => {
        // `${zodError}` renders as a multi-line JSON dump of the whole issue array: unusable in a
        // log line and unsafe to forward to a client. The caller needs to know which field failed.
        try {
            await broker.call('validationdemo.greet', { times: 2 } as never);
            throw new Error('expected the call to reject');
        } catch (err) {
            const message = (err as Error).message;
            expect(message).toContain('name');
            expect(message).not.toContain('\n');
            expect(message).toContain('validationdemo.greet');
        }
    });

    it('still accepts valid params', async () => {
        const result = await broker.call('validationdemo.greet', { name: 'ada' } as never);
        expect(result).toEqual({ greeting: 'hello ada' });
    });
});
