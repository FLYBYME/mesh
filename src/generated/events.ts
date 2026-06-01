// GENERATED FILE - DO NOT EDIT
import { z } from 'zod';
import type { EventRegistry } from '../interfaces/IEventContract.js';
import * as Contract_0 from '../examples/demo/demo.contract.js';

declare module '../interfaces/IEventContract.js' {
    interface EventRegistry {
        'demo.hello.sent': z.infer<typeof Contract_0.demoHelloSentEvent['schema']>;
    }
}

export type { EventRegistry };
