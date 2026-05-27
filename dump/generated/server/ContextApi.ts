import { z } from 'zod';
import { IMeshApi } from '../api';
import { IServiceContext } from '../../services/ServiceModule';
import { ServiceExecutor } from '../../services/ServiceExecutor';
import * as Contract_0 from '../../../dump/demo-service/demo.contract';

export class ContextApi implements IMeshApi {
    constructor(private executor: ServiceExecutor<ContextApi>, private context: IServiceContext<ContextApi>) { }

    public readonly demo = {
        hello: (args: z.input<typeof Contract_0.demoHelloContract['inputSchema']>): Promise<z.infer<typeof Contract_0.demoHelloContract['outputSchema']>> =>
            this.executor.execute<z.infer<typeof Contract_0.demoHelloContract['outputSchema']>>('demo', 'hello', args, this.context as any),
        create_user: (args: z.input<typeof Contract_0.userCrud['create']['inputSchema']>): Promise<z.infer<typeof Contract_0.userCrud['create']['outputSchema']>> =>
            this.executor.execute<z.infer<typeof Contract_0.userCrud['create']['outputSchema']>>('demo', 'create_user', args, this.context as any),
        find: (args: z.input<typeof Contract_0.userCrud['find']['inputSchema']>): Promise<z.infer<typeof Contract_0.userCrud['find']['outputSchema']>> =>
            this.executor.execute<z.infer<typeof Contract_0.userCrud['find']['outputSchema']>>('demo', 'find', args, this.context as any),
        find_one: (args: z.input<typeof Contract_0.userCrud['findOne']['inputSchema']>): Promise<z.infer<typeof Contract_0.userCrud['findOne']['outputSchema']>> =>
            this.executor.execute<z.infer<typeof Contract_0.userCrud['findOne']['outputSchema']>>('demo', 'find_one', args, this.context as any),
        count: (args: z.input<typeof Contract_0.userCrud['count']['inputSchema']>): Promise<z.infer<typeof Contract_0.userCrud['count']['outputSchema']>> =>
            this.executor.execute<z.infer<typeof Contract_0.userCrud['count']['outputSchema']>>('demo', 'count', args, this.context as any),
        get: (args: z.input<typeof Contract_0.userCrud['get']['inputSchema']>): Promise<z.infer<typeof Contract_0.userCrud['get']['outputSchema']>> =>
            this.executor.execute<z.infer<typeof Contract_0.userCrud['get']['outputSchema']>>('demo', 'get', args, this.context as any),
        update: (args: z.input<typeof Contract_0.userCrud['update']['inputSchema']>): Promise<z.infer<typeof Contract_0.userCrud['update']['outputSchema']>> =>
            this.executor.execute<z.infer<typeof Contract_0.userCrud['update']['outputSchema']>>('demo', 'update', args, this.context as any),
        delete: (args: z.input<typeof Contract_0.userCrud['delete']['inputSchema']>): Promise<z.infer<typeof Contract_0.userCrud['delete']['outputSchema']>> =>
            this.executor.execute<z.infer<typeof Contract_0.userCrud['delete']['outputSchema']>>('demo', 'delete', args, this.context as any),
    };
}
