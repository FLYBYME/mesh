import { z } from 'zod';
import { MeshApp } from '../../core/MeshApp.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';
import { RegistryModule } from '../../modules/RegistryModule.js';
import { BrokerModule } from '../../modules/BrokerModule.js';
import { PlacementRegistry } from '../../core/PlacementRegistry.js';
import { defineContract, defaultPrint } from '../../interfaces/IToolContract.js';
import { defineEventHandler } from '../../interfaces/IEventHandler.js';
import type { IServiceBroker } from '../../interfaces/IServiceBroker.js';

/**
 * Whose work is running (broker.ownerInEffect): an owned contract's handler, and everything it
 * leaves running -- a timer, a socket's callback -- carries its owner, so a process-level handler
 * can tell whose code an uncaught error came from when the stack names none of it (11-05: node:net's
 * EADDRINUSE out of the SSH door's listen ended its node).
 */
declare global {
    interface EventRegistry {
        'ownerineffect.ping': Record<string, never>;
    }
}

const common = {
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    filePath: 'src/__tests__/core/OwnerInEffect.spec.ts',
    permissions: [],
    print: defaultPrint,
};
const owned = defineContract({ ...common, domain: 'ownerineffect', action: 'owned', description: 'Mounted by a part', concurrency: 'long-running' });
const plain = defineContract({ ...common, domain: 'ownerineffect', action: 'plain', description: 'Mounted by nobody', concurrency: 'on-demand' });
const pinged = defineEventHandler({ event: 'ownerineffect.ping', domain: 'ownerineffect', delivery: 'each', description: 'test' });

const later = (fn: () => void): Promise<void> => new Promise((resolve) => {
    setTimeout(() => {
        fn();
        resolve();
    }, 5);
});

describe('broker.ownerInEffect', () => {
    let app: MeshApp;
    let broker: IServiceBroker;

    beforeAll(async () => {
        app = new MeshApp({ nodeID: 'ownerineffect-node', namespace: 'test', logger: new Logger(LogLevel.ERROR) });
        app.use(new RegistryModule({ preferLocal: true, implementation: PlacementRegistry }));
        app.use(new BrokerModule());
        await app.start();
        broker = app.getProvider<IServiceBroker>('broker');
    });

    afterAll(async () => {
        await app.stop();
    });

    it('is the owner inside an owned contract, and in what its handler leaves running', async () => {
        const seen: Array<string | undefined> = [];
        let leftRunning: Promise<void> = Promise.resolve();
        broker.withOwner('part:door', () => broker.registerContract(owned, async () => {
            seen.push(broker.ownerInEffect());
            leftRunning = later(() => seen.push(broker.ownerInEffect()));
            return {};
        }));

        // Called from outside any owner, as serve.part.start's onStart calls a part's listen.
        await broker.call('ownerineffect.owned', {});
        await leftRunning;

        expect(seen).toEqual(['part:door', 'part:door']);
        await broker.unregisterOwner('part:door');
    });

    it('is nobody\'s outside, and in a contract nobody owns', async () => {
        let inside: string | undefined = 'unset';
        broker.registerContract(plain, async () => {
            inside = broker.ownerInEffect();
            return {};
        });

        await broker.call('ownerineffect.plain', {});

        expect(broker.ownerInEffect()).toBeUndefined();
        expect(inside).toBeUndefined();
        await broker.unregisterContract('ownerineffect.plain');
    });

    it('an owned event handler runs as its owner, whoever raised the event', async () => {
        let heard: string | undefined;
        let done: () => void = () => undefined;
        const ran = new Promise<void>((resolve) => { done = resolve; });
        broker.withOwner('part:listener', () => broker.registerEventHandler(pinged, () => {
            heard = broker.ownerInEffect();
            done();
        }));

        broker.withOwner('part:raiser', () => broker.emit('ownerineffect.ping', {}, { skipNetwork: true }));
        await ran;

        expect(heard).toBe('part:listener');
        await broker.unregisterOwner('part:listener');
    });

    it('a part\'s handler registering during a call registers as the part: its unload takes it back', async () => {
        let heard = 0;
        broker.withOwner('part:late', () => broker.registerContract(owned, async () => {
            broker.registerEventHandler(pinged, () => {
                heard += 1;
            });
            return {};
        }, { replace: true }));
        await broker.call('ownerineffect.owned', {});
        broker.emit('ownerineffect.ping', {}, { skipNetwork: true });
        await later(() => undefined);
        expect(heard).toBe(1);

        await broker.unregisterOwner('part:late');
        broker.emit('ownerineffect.ping', {}, { skipNetwork: true });
        await later(() => undefined);

        expect(heard).toBe(1);
    });
});
