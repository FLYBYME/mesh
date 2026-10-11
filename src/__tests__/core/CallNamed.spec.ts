import { ServiceBroker } from '../../core/ServiceBroker.js';
import { defineContract } from '../../interfaces/IToolContract.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { z } from 'zod';

const doubleContract = defineContract({
    domain: 'callnamed', action: 'double',
    description: 'Test only: doubles a number.',
    inputSchema: z.object({ n: z.number() }),
    outputSchema: z.object({ doubled: z.number() }),
    rest: { method: 'POST', path: '/callnamed/double' },
    filePath: 'src/__tests__/core/CallNamed.spec.ts', concurrency: 'on-demand', permissions: [],
    print: (o) => String(o.doubled),
});

declare global {
    interface IServiceToolRegistry {
        'callnamed.double': { params: { n: number }; returns: { doubled: number } };
    }
}

/**
 * callNamed (10-10): a contract named in data -- a queued job, a held call, a workflow step -- with
 * no cast: an unknown name is a 404, and the input is checked by the contract's own schema.
 */
describe('callNamed', () => {
    const broker = new ServiceBroker('call-named', new Logger(LogLevel.ERROR));
    broker.registerContract(doubleContract, async (input) => ({ doubled: input.n * 2 }));

    it('calls the contract the name says, with the input as data', async () => {
        await expect(broker.callNamed('callnamed.double', { n: 21 })).resolves.toEqual({ doubled: 42 });
    });

    it('refuses a name no node runs or advertises: 404, not a call that goes nowhere', async () => {
        await expect(broker.callNamed('callnamed.nothing', {})).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    });

    it('refuses input the contract does not accept, by its own schema', async () => {
        await expect(broker.callNamed('callnamed.double', { n: 'twenty-one' })).rejects.toThrow();
    });
});
