// GENERATED FILE - DO NOT EDIT
import { z } from 'zod';
import * as Contract_0 from '../examples/demo/demo.contract.js';

declare global {
    interface IServiceToolRegistry {
        'demo.hello': { params: z.input<typeof Contract_0.demoHelloContract['inputSchema']>, returns: z.infer<typeof Contract_0.demoHelloContract['outputSchema']> };
        'demo.status': { params: z.input<typeof Contract_0.demoStatusContract['inputSchema']>, returns: z.infer<typeof Contract_0.demoStatusContract['outputSchema']> };
        'demo.notify': { params: z.input<typeof Contract_0.demoNotifyContract['inputSchema']>, returns: z.infer<typeof Contract_0.demoNotifyContract['outputSchema']> };
        'demo.create': { params: z.input<typeof Contract_0.demoCrud['create']['inputSchema']>, returns: z.infer<typeof Contract_0.demoCrud['create']['outputSchema']> };
        'demo.find': { params: z.input<typeof Contract_0.demoCrud['find']['inputSchema']>, returns: z.infer<typeof Contract_0.demoCrud['find']['outputSchema']> };
        'demo.find_one': { params: z.input<typeof Contract_0.demoCrud['findOne']['inputSchema']>, returns: z.infer<typeof Contract_0.demoCrud['findOne']['outputSchema']> };
        'demo.count': { params: z.input<typeof Contract_0.demoCrud['count']['inputSchema']>, returns: z.infer<typeof Contract_0.demoCrud['count']['outputSchema']> };
        'demo.get': { params: z.input<typeof Contract_0.demoCrud['get']['inputSchema']>, returns: z.infer<typeof Contract_0.demoCrud['get']['outputSchema']> };
        'demo.update': { params: z.input<typeof Contract_0.demoCrud['update']['inputSchema']>, returns: z.infer<typeof Contract_0.demoCrud['update']['outputSchema']> };
        'demo.delete': { params: z.input<typeof Contract_0.demoCrud['delete']['inputSchema']>, returns: z.infer<typeof Contract_0.demoCrud['delete']['outputSchema']> };
        'demometrics.insert': { params: z.input<typeof Contract_0.demoTimeSeries['insert']['inputSchema']>, returns: z.infer<typeof Contract_0.demoTimeSeries['insert']['outputSchema']> };
        'demometrics.query': { params: z.input<typeof Contract_0.demoTimeSeries['query']['inputSchema']>, returns: z.infer<typeof Contract_0.demoTimeSeries['query']['outputSchema']> };
        'demometrics.aggregate': { params: z.input<typeof Contract_0.demoTimeSeries['aggregate']['inputSchema']>, returns: z.infer<typeof Contract_0.demoTimeSeries['aggregate']['outputSchema']> };
        'demometrics.latest': { params: z.input<typeof Contract_0.demoTimeSeries['latest']['inputSchema']>, returns: z.infer<typeof Contract_0.demoTimeSeries['latest']['outputSchema']> };
    }
}

export type { IServiceToolRegistry };
