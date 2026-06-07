import { AuthInterceptor } from '../interceptors/AuthInterceptor.js';
import { MeshPacket } from '../interfaces/IMeshNetwork.js';
import { Logger } from '../utils/Logger.js';
import { LogLevel } from '../interfaces/ILogger.js';

describe('AuthInterceptor', () => {
    let interceptor: AuthInterceptor;
    let logger: Logger;

    beforeEach(() => {
        logger = new Logger(LogLevel.ERROR);
        interceptor = new AuthInterceptor(logger);
    });

    it('should allow packets when senderNodeID matches authenticatedNodeID', async () => {
        const packet: MeshPacket = {
            id: 'p1',
            topic: 'test',
            senderNodeID: 'node-A',
            type: 'EVENT',
            timestamp: Date.now(),
            meta: { authenticatedNodeID: 'node-A' }
        } as MeshPacket;

        const result = await interceptor.onInbound(packet);
        expect(result.topic).toBe('test');
    });

    it('should drop packets when senderNodeID does NOT match authenticatedNodeID', async () => {
        const packet: MeshPacket = {
            id: 'p1',
            topic: 'test',
            senderNodeID: 'node-A',
            type: 'EVENT',
            timestamp: Date.now(),
            meta: { authenticatedNodeID: 'node-B' } // Spoofed!
        } as MeshPacket;

        const result = await interceptor.onInbound(packet);
        expect(result.topic).toBe('__auth_failed');
    });

    it('should allow local packets even without authenticatedNodeID', async () => {
        const packet: MeshPacket = {
            id: 'p1',
            topic: 'test',
            senderNodeID: 'local-node',
            type: 'EVENT',
            timestamp: Date.now(),
            meta: { local: true }
        } as MeshPacket;

        const result = await interceptor.onInbound(packet);
        expect(result.topic).toBe('test');
    });

    it('should allow packets without authenticatedNodeID (e.g. from insecure transports if allowed)', async () => {
        // By default, if the transport doesn't provide it, we might allow it 
        // unless we want to enforce strict auth everywhere.
        const packet: MeshPacket = {
            id: 'p1',
            topic: 'test',
            senderNodeID: 'node-A',
            type: 'EVENT',
            timestamp: Date.now(),
            meta: {}
        } as MeshPacket;

        const result = await interceptor.onInbound(packet);
        expect(result.topic).toBe('test');
    });
});
