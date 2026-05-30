import { z } from 'zod';
import { DemoSchema, DemoMetricSchema } from './demo.schema.js';
import { defineCrud } from '../../interfaces/ICrudContract.js';
import { defineTimeSeries } from '../../interfaces/ITimeSeriesContract.js';
import { defaultPrint, defineContract } from '../../interfaces/IToolContract.js';
import { defineEvent } from '../../interfaces/IEventContract.js';

// ─── Event Augmentation ──────────────────────────────────────────────────────
// We augment the EventRegistry to register our domain-specific events.

declare module '../../interfaces/IEventContract.js' {
    interface EventRegistry {
        'demo.hello.sent': DemoHelloEvent;
    }
}

export const DemoHelloEventSchema = z.object({
    name: z.string().describe("Name of the person greeted"),
    timestamp: z.date()
});
export type DemoHelloEvent = z.infer<typeof DemoHelloEventSchema>;

/** Event definition — discovered by the generator. */
export const demoHelloSentEvent = defineEvent('demo.hello.sent', DemoHelloEventSchema);

// ─── CRUD ────────────────────────────────────────────────────────────────────

export const demoCrud = defineCrud('demo', DemoSchema, {
    // options
});

// ─── Time Series ─────────────────────────────────────────────────────────────

export const demoTimeSeries = defineTimeSeries('demometrics', DemoMetricSchema);

// ─── Contracts ───────────────────────────────────────────────────────────────

export const DemoHelloSchema = z.object({
    name: z.string().describe("Your name")
});
export type DemoHello = z.infer<typeof DemoHelloSchema>;

export const DemoHelloOutputSchema = z.object({
    message: z.string().describe("Greeting message")
});
export type DemoHelloOutput = z.infer<typeof DemoHelloOutputSchema>;

export const demoHelloContract = defineContract({
    domain: 'demo',
    action: 'hello',
    description: 'A simple hello world tool for demonstration.',
    inputSchema: DemoHelloSchema,
    outputSchema: DemoHelloOutputSchema,
    rest: { method: 'POST', path: '/demo/hello' },
    destructive: false,
    print: defaultPrint
});

export const DemoStatusSchema = z.object({
    name: z.string().describe("Your name")
});
export type DemoStatus = z.infer<typeof DemoStatusSchema>;

export const DemoStatusOutputSchema = z.object({
    message: z.string().describe("Greeting message")
});
export type DemoStatusOutput = z.infer<typeof DemoStatusOutputSchema>;

export const demoStatusContract = defineContract({
    domain: 'demo',
    action: 'status',
    description: 'Check the status of the demo environment.',
    inputSchema: DemoStatusSchema,
    outputSchema: DemoStatusOutputSchema,
    rest: { method: 'GET', path: '/demo/status' },
    destructive: false,
    print: defaultPrint
});

export const DemoNotifySchema = z.object({
    title: z.string().describe("Notification title"),
    message: z.string().describe("Detailed message"),
    type: z.enum(['info', 'success', 'warning', 'error']).optional().default('info')
});

export const demoNotifyContract = defineContract({
    domain: 'demo',
    action: 'notify',
    description: 'Send a notification via the system notifications service.',
    inputSchema: DemoNotifySchema,
    outputSchema: z.object({ success: z.boolean() }),
    rest: { method: 'POST', path: '/demo/notify' },
    print: defaultPrint
});
