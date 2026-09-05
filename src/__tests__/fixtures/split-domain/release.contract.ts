import { z } from 'zod';
import { defaultPrint, defineContract } from '../../../interfaces/IToolContract.js';
import { defineCrud } from '../../../interfaces/ICrudContract.js';
import { defineEvent } from '../../../interfaces/IEventContract.js';

export const ReleaseSchema = z.object({
    version: z.string(),
});

export const ReleaseEventSchema = z.object({
    version: z.string(),
});

export const releaseEvent = defineEvent('cdn.released', ReleaseEventSchema);

export const releaseDeployContract = defineContract({
    domain: 'cdn',
    action: 'deploy',
    description: 'Deploy a release',
    inputSchema: z.object({ version: z.string() }),
    outputSchema: z.object({ success: z.boolean() }),
    rest: { method: 'POST', path: '/cdn/deploy' },
    print: defaultPrint,
});

export const releaseCrud = defineCrud('cdn', ReleaseSchema, {
    dependencies: [],
});
