import { z } from 'zod';
import { defineContract, defaultPrint } from '../contracts/tool_contract';
import { defineCrud } from '../contracts/crud_contract';

export const DemoHelloSchema = z.object({
    name: z.string().describe("Your name")
});

export const DemoHelloOutputSchema = z.object({
    message: z.string().describe("Greeting message")
});

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

// Base Schema for the REST API (No ID)
export const BaseUserSchema = z.object({
    name: z.string(),
    email: z.string().email(),
    status: z.enum(['active', 'inactive']).default('active')
});

// Full Schema for the Database (Includes ID)
export const DbUserSchema = BaseUserSchema.extend({
    id: z.string()
});

export const userCrud = defineCrud('demo', BaseUserSchema, {
    pluralPath: 'users',
    actions: { create: 'create_user', findOne: 'find_user' }
});
