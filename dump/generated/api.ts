import { z } from 'zod';
import { IMeshApi } from '../services/api';
import * as Contract_0 from '../demo-service/demo.contract';

declare module '../services/api' {
    interface IMeshApi {
        readonly demo: {
            /** A simple hello world tool for demonstration. */
            readonly hello: (args: z.input<typeof Contract_0.demoHelloContract['inputSchema']>) => Promise<z.infer<typeof Contract_0.demoHelloContract['outputSchema']>>;
            /** CRUD create for demo (userCrud) */
            readonly create_user: (args: z.input<typeof Contract_0.userCrud['create']['inputSchema']>) => Promise<z.infer<typeof Contract_0.userCrud['create']['outputSchema']>>;
            /** CRUD find for demo (userCrud) */
            readonly find: (args: z.input<typeof Contract_0.userCrud['find']['inputSchema']>) => Promise<z.infer<typeof Contract_0.userCrud['find']['outputSchema']>>;
            /** CRUD findOne for demo (userCrud) */
            readonly find_one: (args: z.input<typeof Contract_0.userCrud['findOne']['inputSchema']>) => Promise<z.infer<typeof Contract_0.userCrud['findOne']['outputSchema']>>;
            /** CRUD count for demo (userCrud) */
            readonly count: (args: z.input<typeof Contract_0.userCrud['count']['inputSchema']>) => Promise<z.infer<typeof Contract_0.userCrud['count']['outputSchema']>>;
            /** CRUD get for demo (userCrud) */
            readonly get: (args: z.input<typeof Contract_0.userCrud['get']['inputSchema']>) => Promise<z.infer<typeof Contract_0.userCrud['get']['outputSchema']>>;
            /** CRUD update for demo (userCrud) */
            readonly update: (args: z.input<typeof Contract_0.userCrud['update']['inputSchema']>) => Promise<z.infer<typeof Contract_0.userCrud['update']['outputSchema']>>;
            /** CRUD delete for demo (userCrud) */
            readonly delete: (args: z.input<typeof Contract_0.userCrud['delete']['inputSchema']>) => Promise<z.infer<typeof Contract_0.userCrud['delete']['outputSchema']>>;
        };
    }
}

export { IMeshApi };
