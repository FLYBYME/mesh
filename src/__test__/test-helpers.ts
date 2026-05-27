import { ILogger, LogLevel } from '../interfaces/ILogger.js';
import { IServiceBroker } from '../interfaces/IServiceBroker.js';
import { IMeshNetwork, IServiceNode } from '../interfaces/IMeshNetwork.js';
import { IServiceRegistry } from '../interfaces/IServiceRegistry.js';
import { IContext } from '../interfaces/IContext.js';
import { ServiceModule } from '../core/ServiceModule.js';
import { nanoid } from 'nanoid';

export function createMockLogger(): ILogger {
    return {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        child: jest.fn().mockImplementation(() => createMockLogger()),
        getLevel: jest.fn().mockReturnValue(LogLevel.DEBUG)
    };
}

export function createMockBroker(): jest.Mocked<IServiceBroker> {
    return {
        nodeID: 'mock-node-1',
        logger: createMockLogger(),
        registry: createMockRegistry(),
        network: createMockNetwork(),
        registerProvider: jest.fn(),
        getProvider: jest.fn(),
        pipe: jest.fn().mockReturnThis(),
        setNetwork: jest.fn(),
        setRegistry: jest.fn(),
        use: jest.fn(),
        useLocal: jest.fn(),
        getContext: jest.fn(),
        on: jest.fn().mockReturnValue(() => {}),
        off: jest.fn(),
        registerModule: jest.fn(),
        call: jest.fn(),
        emit: jest.fn(),
        handleIncomingRPC: jest.fn(),
        handlePipeline: jest.fn(),
        executeRemote: jest.fn(),
        start: jest.fn(),
        stop: jest.fn()
    };
}

export function createMockNetwork(): jest.Mocked<IMeshNetwork> {
    return {
        nodeID: 'mock-node-1',
        start: jest.fn(),
        stop: jest.fn(),
        send: jest.fn(),
        publish: jest.fn(),
        onMessage: jest.fn()
    } as unknown as jest.Mocked<IMeshNetwork>;
}

export function createMockRegistry(): jest.Mocked<IServiceRegistry> {
    return {
        waitForService: jest.fn(),
        waitForNodes: jest.fn(),
        waitForTool: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
        listModules: jest.fn().mockReturnValue([]),
        registerModule: jest.fn(),
        unregisterModule: jest.fn(),
        getModule: jest.fn(),
        unregisterNode: jest.fn(),
        heartbeat: jest.fn(),
        findNodesForTool: jest.fn().mockReturnValue([]),
        selectNode: jest.fn(),
        registerNode: jest.fn(),
        registerLocalModule: jest.fn(),
        registerTool: jest.fn(),
        getTool: jest.fn(),
        getTools: jest.fn().mockReturnValue([]),
        getNodes: jest.fn().mockReturnValue([]),
        getAvailableNodes: jest.fn().mockReturnValue([]),
        getNode: jest.fn(),
        getNextToolEndpoint: jest.fn(),
        getServiceNames: jest.fn().mockReturnValue([]),
        setBalancer: jest.fn()
    } as unknown as jest.Mocked<IServiceRegistry>;
}

export function createTestContext(params: any = {}): IContext<Record<string, unknown>, Record<string, unknown>> {
    return {
        id: nanoid(),
        correlationID: nanoid(),
        toolName: 'test.action',
        params,
        meta: {},
        nodeID: 'test-node-1',
        callerID: 'test-caller-1',
        traceId: nanoid(),
        spanId: nanoid(),
    };
}

export class TestServiceModule extends ServiceModule {
    public readonly domain = 'testdomain';

    constructor() {
        super();
    }
    
    // Helper to expose protected methods for testing
    public mountTestTool(contract: any, handler: any) {
        this.mountTool(contract, handler);
    }
    
    public mountTestCrud(contracts: any) {
        this.mountCrud(contracts);
    }

    public mountTestEventHandler(name: any, handler: any) {
        this.mountEventHandler(name, handler);
    }

    public mountTestCrudHook(domain: string, action: string, hooks: any) {
        this.mountCrudHook(domain, action, hooks);
    }
}
