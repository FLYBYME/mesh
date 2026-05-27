import { MeshOrchestrator } from '../../src/core/MeshOrchestrator.js';
import { ILogger } from '../../src/interfaces/ILogger.js';
import { IMeshNetworkNode } from '../../src/interfaces/IMeshNetwork.js';
import { Registry } from '../../src/core/Registry.js';

describe('MeshOrchestrator', () => {
    let orchestrator: MeshOrchestrator;
    let mockNode: jest.Mocked<IMeshNetworkNode>;
    let mockRegistry: Registry;
    let mockLogger: jest.Mocked<ILogger>;

    beforeEach(() => {
        mockLogger = {
            info: jest.fn(),
            debug: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            child: jest.fn().mockReturnThis(),
        } as any;

        mockRegistry = new Registry(mockLogger, { localNodeID: 'local' });
        
        mockNode = {
            nodeID: 'local',
            logger: mockLogger,
            registry: mockRegistry,
            connectToPeer: jest.fn().mockResolvedValue(undefined),
            send: jest.fn().mockResolvedValue(undefined),
            publish: jest.fn().mockResolvedValue(undefined),
        } as any;

        orchestrator = new MeshOrchestrator(mockNode, {
            bootstrapNodes: ['addr1', 'addr2'],
            gossipIntervalMs: 1000,
        });

        jest.useFakeTimers();
    });

    afterEach(() => {
        orchestrator.stop();
        jest.useRealTimers();
    });

    test('should bootstrap on start', async () => {
        await orchestrator.start();
        expect(mockNode.connectToPeer).toHaveBeenCalledTimes(2);
        expect(mockNode.connectToPeer).toHaveBeenCalledWith(expect.stringContaining('bootstrap_'), 'addr1');
        expect(mockNode.connectToPeer).toHaveBeenCalledWith(expect.stringContaining('bootstrap_'), 'addr2');
    });

    test('should broadcast presence on start', async () => {
        await orchestrator.start();
        expect(mockNode.send).toHaveBeenCalledWith('*', '$node.presence', expect.any(Object));
    });

    test('should start gossip and presence intervals', async () => {
        await orchestrator.start();
        
        // Clear initial calls
        mockNode.send.mockClear();
        mockNode.publish.mockClear();

        // Add several nodes to ensure gossipRound picks a remote one eventually
        for (let i = 0; i < 5; i++) {
            mockRegistry.registerNode({ nodeID: `remote-${i}`, available: true, services: [] } as any);
        }
        
        // Advance for gossip - multiple times to be sure
        for (let i = 0; i < 10; i++) {
            jest.advanceTimersByTime(1000);
        }
        expect(mockNode.publish).toHaveBeenCalledWith('$node.pex', expect.any(Object));

        // Advance for presence (15s)
        jest.advanceTimersByTime(15000);
        expect(mockNode.send).toHaveBeenCalledWith('*', '$node.presence', expect.any(Object));
    });

    test('should broadcast presence when local registry changes', async () => {
        await orchestrator.start();
        mockNode.send.mockClear();

        mockRegistry.emit('local:changed');
        expect(mockNode.send).toHaveBeenCalledWith('*', '$node.presence', expect.any(Object));
    });

    test('handlePeerConnect should send presence and PEX to the new peer', async () => {
        await orchestrator.handlePeerConnect('new-peer');
        
        expect(mockNode.send).toHaveBeenCalledWith('new-peer', '$node.presence', expect.any(Object));
        expect(mockNode.send).toHaveBeenCalledWith('new-peer', '$node.pex', expect.any(Object));
    });

    test('handlePeerDisconnect should remove node from registry', async () => {
        mockRegistry.registerNode({ nodeID: 'dying', services: [], available: true } as any);
        expect(mockRegistry.getNode('dying')).toBeDefined();

        await orchestrator.handlePeerDisconnect('dying');
        expect(mockRegistry.getNode('dying')).toBeUndefined();
    });

    test('handlePEX should register new peers', async () => {
        const pexData = {
            peers: [
                { nodeID: 'p1', available: true, services: [] },
                { nodeID: 'p2', available: true, services: [] }
            ]
        };

        await orchestrator.handlePEX(pexData as any);
        expect(mockRegistry.getNode('p1')).toBeDefined();
        expect(mockRegistry.getNode('p2')).toBeDefined();
    });

    test('handlePresence should register node and respond if new', async () => {
        const presenceData = {
            node: { nodeID: 'new-node', services: [], available: true }
        };

        mockNode.send.mockClear();
        await orchestrator.handlePresence(presenceData as any);
        
        expect(mockRegistry.getNode('new-node')).toBeDefined();
        // Should respond with our presence because it's new
        expect(mockNode.send).toHaveBeenCalledWith('new-node', '$node.presence', expect.any(Object));
    });

    test('handlePresence should NOT respond if node already known', async () => {
        mockRegistry.registerNode({ nodeID: 'known-node', services: [], available: true } as any);
        
        const presenceData = {
            node: { nodeID: 'known-node', services: [], available: true, nodeSeq: 2 }
        };

        mockNode.send.mockClear();
        await orchestrator.handlePresence(presenceData as any);
        
        expect(mockRegistry.getNode('known-node')?.nodeSeq).toBe(2);
        expect(mockNode.send).not.toHaveBeenCalled();
    });

    test('gossipRound should NOT gossip if no other nodes', async () => {
        await orchestrator.start();
        mockNode.publish.mockClear();

        // Only local node in registry
        await (orchestrator as any).gossipRound();
        expect(mockNode.publish).not.toHaveBeenCalled();
    });

    test('gossipRound should pick a random node and publish PEX', async () => {
        mockRegistry.registerNode({ nodeID: 'r1', available: true, services: [], addresses: [], timestamp: 0, nodeSeq: 1 } as any);
        mockRegistry.registerNode({ nodeID: 'r2', available: true, services: [], addresses: [], timestamp: 0, nodeSeq: 1 } as any);

        // Force picking r1 (index 1 if local is 0)
        const spy = jest.spyOn(Math, 'random').mockReturnValue(0.5); // (0.5 * 3) = 1.5 -> floor is 1

        await (orchestrator as any).gossipRound();
        expect(mockNode.publish).toHaveBeenCalledWith('$node.pex', expect.objectContaining({
            peers: expect.any(Array)
        }));
        
        spy.mockRestore();
    });

    test('stop should clear intervals', async () => {
        await orchestrator.start();
        const gossipInterval = (orchestrator as any).gossipInterval;
        const presenceInterval = (orchestrator as any).presenceInterval;
        
        expect(gossipInterval).toBeDefined();
        expect(presenceInterval).toBeDefined();

        await orchestrator.stop();
        expect((orchestrator as any).gossipInterval).toBeUndefined();
        expect((orchestrator as any).presenceInterval).toBeUndefined();
    });

    test('bootstrap should handle connection failures gracefully', async () => {
        mockNode.connectToPeer.mockRejectedValueOnce(new Error('connection failed'));
        
        await orchestrator.start();
        // Should still attempt second node
        expect(mockNode.connectToPeer).toHaveBeenCalledTimes(2);
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to bootstrap from addr1'));
    });

    test('handlePEX should ignore self-referencing peer data', async () => {
        const pexData = {
            peers: [
                { nodeID: 'local', available: true, services: [] }, // our own ID
                { nodeID: 'p1', available: true, services: [] }
            ]
        };

        const spy = jest.spyOn(mockRegistry, 'registerNode');
        await orchestrator.handlePEX(pexData as any);
        
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).not.toHaveBeenCalledWith(expect.objectContaining({ nodeID: 'local' }));
    });

    test('handlePresence should ignore our own presence broadcast', async () => {
        const spy = jest.spyOn(mockRegistry, 'registerNode');
        await orchestrator.handlePresence({ node: { nodeID: 'local' } } as any);
        expect(spy).not.toHaveBeenCalled();
    });

    test('broadcastPresence should work with specific target', async () => {
        await orchestrator.broadcastPresence('target-node');
        expect(mockNode.send).toHaveBeenCalledWith('target-node', '$node.presence', expect.any(Object));
    });

    test('handlePeerConnect should log error if broadcast fails', async () => {
        mockNode.send.mockRejectedValueOnce(new Error('send failed'));
        await orchestrator.handlePeerConnect('peer1');
        // broadcastPresence catches the error and logs it
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to broadcast presence to peer1: send failed'));
    });
});
