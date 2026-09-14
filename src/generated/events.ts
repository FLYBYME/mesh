// GENERATED FILE - DO NOT EDIT
import { z } from 'zod';
import * as Contract_0 from '../examples/demo/demo.contract.js';

declare global {
    interface EventRegistry {
        'demo.hello.sent': z.infer<typeof Contract_0.demoHelloSentEvent['schema']>;
        'demo.created': z.infer<typeof Contract_0.demoCrud['create']['outputSchema']>;
        'demo.updated': { id: string; patch: Record<string, unknown>; item: z.infer<typeof Contract_0.demoCrud['update']['outputSchema']> };
        'demo.deleted': { id: string };
    }
}

export type { EventRegistry };
