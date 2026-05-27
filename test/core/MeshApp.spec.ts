import { MeshApp } from '../../src/core/MeshApp.js';
import { IMeshModule } from '../../src/interfaces/IMeshModule.js';
import { Logger } from '../../src/utils/Logger.js';

describe('MeshApp', () => {
    let app: MeshApp;

    beforeEach(() => {
        app = new MeshApp({ nodeID: 'test-node' });
    });

    it('should initialize with correct nodeID', () => {
        expect(app.nodeID).toBe('test-node');
    });

    it('should register and retrieve providers', () => {
        const mockProvider = { data: 'test' };
        app.registerProvider('mock', mockProvider);
        expect(app.getProvider('mock')).toBe(mockProvider);
    });

    it('should throw error when provider is not found', () => {
        expect(() => app.getProvider('non-existent')).toThrow('[MeshApp] Provider not found');
    });

    it('should manage modules and run boot sequence', async () => {
        const initSpy = jest.fn();
        const startSpy = jest.fn();
        const readySpy = jest.fn();

        const mockModule: IMeshModule = {
            name: 'test-module' as any,
            domain: 'test-module' as any,
            onInit: initSpy,
            onStart: startSpy,
            onReady: readySpy
        } as any;

        app.use(mockModule);
        await app.start();

        expect(initSpy).toHaveBeenCalledWith(app);
        expect(startSpy).toHaveBeenCalledWith(app);
        expect(readySpy).toHaveBeenCalledWith(app);
    });

    it('should detect circular dependencies', async () => {
        const modA: IMeshModule = {
            name: 'A' as any,
            domain: 'A' as any,
            dependencies: ['B']
        } as any;
        const modB: IMeshModule = {
            name: 'B' as any,
            domain: 'B' as any,
            dependencies: ['A']
        } as any;

        app.use(modA);
        app.use(modB);

        await expect(app.start()).rejects.toThrow('Circular dependency detected');
    });

    it('should teardown modules in reverse order', async () => {
        const stopOrder: string[] = [];
        const modA: IMeshModule = {
            name: 'A' as any,
            domain: 'A' as any,
            onStop: () => { stopOrder.push('A'); }
        } as any;
        const modB: IMeshModule = {
            name: 'B' as any,
            domain: 'B' as any,
            onStop: () => { stopOrder.push('B'); }
        } as any;

        app.use(modA);
        app.use(modB);
        await app.start();
        await app.stop();

        expect(stopOrder).toEqual(['B', 'A']);
    });
});
