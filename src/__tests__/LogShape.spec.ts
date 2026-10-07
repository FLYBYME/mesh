import { z } from 'zod';
import { Logger } from '../utils/Logger.js';
import { LogLevel } from '../interfaces/ILogger.js';
import { ContextStack } from '../core/ContextStack.js';
import { MeshApp } from '../core/MeshApp.js';
import { RegistryModule } from '../modules/RegistryModule.js';
import { BrokerModule } from '../modules/BrokerModule.js';
import { PlacementRegistry } from '../core/PlacementRegistry.js';
import { defineContract, defaultPrint } from '../interfaces/IToolContract.js';
import type { IServiceBroker } from '../interfaces/IServiceBroker.js';

/**
 * One log shape: a JSON object per line, with who wrote it and in which trace. A plain-text line
 * named nothing -- no contract, no organization, no request -- so one request's lines could not be
 * picked out of a node's log (observability-review.md L).
 */
const record = (line: string | undefined): Record<string, unknown> => {
    const parsed: unknown = JSON.parse(line ?? '{}');
    return typeof parsed === 'object' && parsed !== null ? Object.fromEntries(Object.entries(parsed)) : {};
};

describe('a JSON log line', () => {
    it('has the time, level, message, the logger\'s context, the trace it was written in, and its arguments', () => {
        const lines: string[] = [];
        const logger = new Logger(LogLevel.DEBUG, { node: 'n1' }, (_level, formatted) => { lines.push(formatted); }, 'json');
        const ctx = { id: 's', correlationID: 'c', toolName: 't', params: {}, meta: {}, callerID: null, nodeID: 'n1', traceId: 'trace-1', spanId: 'span-1' };

        ContextStack.run(ctx, () => logger.child({ contract: 'repo.find' }).warn('slow', new Error('boom'), { ms: 900 }));

        const line = record(lines[0]);
        expect(line).toMatchObject({ level: 'warn', msg: 'slow', node: 'n1', contract: 'repo.find', traceId: 'trace-1', spanId: 'span-1' });
        expect(typeof line['time']).toBe('string');
        expect(line['args']).toEqual([expect.objectContaining({ error: 'boom' }), { ms: 900 }]);
    });

    it('is still written when an argument cannot be', () => {
        const lines: string[] = [];
        const logger = new Logger(LogLevel.INFO, {}, (_level, formatted) => { lines.push(formatted); }, 'json');
        const cycle: Record<string, unknown> = {};
        cycle['self'] = cycle;

        logger.info('look', cycle);

        expect(record(lines[0])).toMatchObject({ level: 'info', msg: 'look' });
    });

    it('stays text unless asked', () => {
        const lines: string[] = [];
        new Logger(LogLevel.INFO, {}, (_level, formatted) => { lines.push(formatted); }).info('hello');

        expect(lines[0]).toMatch(/^\[\d{4}-.+\] hello$/);
    });
});

const noisy = defineContract({
    domain: 'logshape', action: 'say', description: 'Writes one line',
    inputSchema: z.object({}), outputSchema: z.object({}),
    filePath: 'src/__tests__/LogShape.spec.ts', concurrency: 'on-demand', permissions: [], print: defaultPrint,
});

declare global {
    interface IServiceToolRegistry {
        'logshape.say': { params: Record<string, never>; returns: Record<string, never> };
    }
}

describe('a handler\'s logger', () => {
    const lines: string[] = [];
    let app: MeshApp;
    let broker: IServiceBroker;

    beforeAll(async () => {
        app = new MeshApp({ nodeID: 'log-node', logger: new Logger(LogLevel.INFO, {}, (_level, formatted) => { lines.push(formatted); }, 'json') });
        app.use(new RegistryModule({ implementation: PlacementRegistry }));
        app.use(new BrokerModule());
        await app.start();
        broker = app.getProvider<IServiceBroker>('broker');
        broker.registerContract(noisy, async (_params, ctx) => {
            ctx.logger.info('said');
            return {};
        });
    });

    afterAll(async () => {
        await app.stop();
    });

    it('names its contract, the organization it ran for, and the trace', async () => {
        await broker.call('logshape.say', {}, { meta: { user: { id: 'u1', tenant_id: 'acme' } }, traceId: 'the-request' });

        const said = lines.map(record).find((l) => l['msg'] === 'said');
        expect(said).toMatchObject({ contract: 'logshape.say', organization: 'acme', traceId: 'the-request' });
    });
});
