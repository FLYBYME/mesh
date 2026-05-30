import { z } from 'zod';
import {
    demoHelloContract,
    demoStatusContract,
    demoNotifyContract
} from './demo.contract.js';
import type { IServiceContext } from '../../interfaces/IServiceContext.js';

export async function demo_hello(
    input: z.infer<typeof demoHelloContract.inputSchema>,
    ctx: IServiceContext
): Promise<z.infer<typeof demoHelloContract.outputSchema>> {

    // 1. Dispatch a strictly-typed custom event
    ctx.emit('demo.hello.sent', {
        name: input.name,
        timestamp: new Date()
    });

    // 2. Record a metric in the time-series store
    await ctx.call('demometrics.insert', [{
        value: 1,
        status: 'greeted',
        tags: { host: 'demo-host', user: input.name }
    }]);

    return {
        message: `Hello, ${input.name}! Event dispatched and metric recorded!`
    };
}

export async function demo_status(
    input: z.infer<typeof demoStatusContract.inputSchema>,
    _ctx: IServiceContext
): Promise<z.infer<typeof demoStatusContract.outputSchema>> {
    return {
        message: `Status check for ${input.name}: Engine is Healthy.`
    };
}

export async function demo_notify(
    input: z.infer<typeof demoNotifyContract.inputSchema>,
    ctx: IServiceContext
): Promise<z.infer<typeof demoNotifyContract.outputSchema>> {
    // Leverage the system notifications service
    // @ts-ignore - TODO: Define notifications contract in the future
    await ctx.call('notifications.send', {
        message: `[${input.title}] ${input.message}`,
        type: input.type as 'info' | 'success' | 'warning' | 'error'
    });

    return { success: true };
}
