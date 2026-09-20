import { Logger } from './utils/Logger.js';
import { ServiceBroker } from './core/ServiceBroker.js';

async function main() {
    const logger = new Logger();
    const broker = new ServiceBroker('node-1', logger);
    await broker.start();

    // Register the demo part
    const { register: registerDemo } = await import('./examples/demo/demo.service.js');
    registerDemo(broker);

    // Try to call the weather tool
    try {
        const data = await broker.call('demo.status', { name: 'demo' });
        console.log('demo.status:', data);
        const data2 = await broker.call('demo.hello', { name: 'world' });
        console.log('demo.hello:', data2);
    } catch (err) {
        console.error('Failed to get data:', err);
    }
}

main().catch(err => {
    console.error('Fatal error in demo:', err);
});