import { z } from 'zod';

export const DemoSchema = z.object({
    name: z.string().describe("Name of the demo item"),
    value: z.number().describe("Value of the demo item"),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
});
export type Demo = z.infer<typeof DemoSchema>;

export const DemoCreateInputSchema = z.object({
    name: z.string().describe("Name of the item"),
    value: z.number().describe("Numeric value"),
});
export type DemoCreateInput = z.infer<typeof DemoCreateInputSchema>;

export const DemoMetricSchema = z.object({
    value: z.number().describe("The metric value"),
    status: z.string().describe("Current status code")
});
export type DemoMetric = z.infer<typeof DemoMetricSchema>;
