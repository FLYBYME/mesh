import { z } from 'zod';
import type { IMeshApp } from '../../interfaces';
import * as Contract_0 from '../../../dump/demo-service/demo.contract';

export class MeshClient {
    constructor(private readonly app: IMeshApp) { }

    public readonly contracts = {
        demo: {
            hello: Contract_0.demoHelloContract,
            create_user: Contract_0.userCrud['create'],
            find: Contract_0.userCrud['find'],
            find_one: Contract_0.userCrud['findOne'],
            count: Contract_0.userCrud['count'],
            get: Contract_0.userCrud['get'],
            update: Contract_0.userCrud['update'],
            delete: Contract_0.userCrud['delete'],
        },
    };

    public readonly api = {
        demo: {
            hello: async (args: z.input<typeof Contract_0.demoHelloContract['inputSchema']>, opts?: any): Promise<z.infer<typeof Contract_0.demoHelloContract['outputSchema']>> => {
                const result = await this.app.call('demo:hello', args, opts);
                return Contract_0.demoHelloContract.outputSchema.parse(result);
            },
            create_user: async (args: z.input<typeof Contract_0.userCrud['create']['inputSchema']>, opts?: any): Promise<z.infer<typeof Contract_0.userCrud['create']['outputSchema']>> => {
                const result = await this.app.call('demo:create_user', args, opts);
                return Contract_0.userCrud['create'].outputSchema.parse(result);
            },
            find: async (args: z.input<typeof Contract_0.userCrud['find']['inputSchema']>, opts?: any): Promise<z.infer<typeof Contract_0.userCrud['find']['outputSchema']>> => {
                const result = await this.app.call('demo:find', args, opts);
                return Contract_0.userCrud['find'].outputSchema.parse(result);
            },
            find_one: async (args: z.input<typeof Contract_0.userCrud['findOne']['inputSchema']>, opts?: any): Promise<z.infer<typeof Contract_0.userCrud['findOne']['outputSchema']>> => {
                const result = await this.app.call('demo:find_one', args, opts);
                return Contract_0.userCrud['findOne'].outputSchema.parse(result);
            },
            count: async (args: z.input<typeof Contract_0.userCrud['count']['inputSchema']>, opts?: any): Promise<z.infer<typeof Contract_0.userCrud['count']['outputSchema']>> => {
                const result = await this.app.call('demo:count', args, opts);
                return Contract_0.userCrud['count'].outputSchema.parse(result);
            },
            get: async (args: z.input<typeof Contract_0.userCrud['get']['inputSchema']>, opts?: any): Promise<z.infer<typeof Contract_0.userCrud['get']['outputSchema']>> => {
                const result = await this.app.call('demo:get', args, opts);
                return Contract_0.userCrud['get'].outputSchema.parse(result);
            },
            update: async (args: z.input<typeof Contract_0.userCrud['update']['inputSchema']>, opts?: any): Promise<z.infer<typeof Contract_0.userCrud['update']['outputSchema']>> => {
                const result = await this.app.call('demo:update', args, opts);
                return Contract_0.userCrud['update'].outputSchema.parse(result);
            },
            delete: async (args: z.input<typeof Contract_0.userCrud['delete']['inputSchema']>, opts?: any): Promise<z.infer<typeof Contract_0.userCrud['delete']['outputSchema']>> => {
                const result = await this.app.call('demo:delete', args, opts);
                return Contract_0.userCrud['delete'].outputSchema.parse(result);
            },
        },
    };
}
