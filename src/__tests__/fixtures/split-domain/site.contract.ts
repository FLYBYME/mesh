import { z } from 'zod';
import { defaultPrint, defineContract } from '../../../interfaces/IToolContract.js';
import { defineEvent } from '../../../interfaces/IEventContract.js';

export const SiteEventSchema = z.object({
    siteId: z.string(),
});

export const siteEvent = defineEvent('cdn.site_updated', SiteEventSchema);

export const siteComposeContract = defineContract({
    domain: 'cdn',
    action: 'compose',
    description: 'Compose site deployment',
    inputSchema: z.object({ siteId: z.string() }),
    outputSchema: z.object({ ok: z.boolean() }),
    rest: { method: 'POST', path: '/cdn/compose' },
    print: defaultPrint,
});
