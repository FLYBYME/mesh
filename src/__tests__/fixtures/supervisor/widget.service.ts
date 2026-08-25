import { z } from 'zod';
import { ServiceModule } from '../../../core/ServiceModule.js';
import { defineCrud } from '../../../interfaces/ICrudContract.js';

export const WidgetSchema = z.object({
    name: z.string(),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
});

export const widgetCrud = defineCrud('sup-widget', WidgetSchema);

export class WidgetService extends ServiceModule {
    public readonly domain = 'sup-widget';
    constructor() {
        super();
        this.mountCrud(widgetCrud);
    }
}

export default WidgetService;
