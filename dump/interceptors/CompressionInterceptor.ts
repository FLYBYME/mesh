import type { IInterceptor } from '../interfaces';
import type { MeshPacket } from '../types/packet.types';
import { Env } from '../utils/Env';

/**
 * CompressionInterceptor — Environment-aware compression.
 * Automatically skips compression in the browser to avoid Node.js dependencies.
 */
export class CompressionInterceptor implements IInterceptor<MeshPacket, MeshPacket> {
    public readonly name = 'compression';

    async onOutbound(packet: MeshPacket): Promise<MeshPacket> {
        if (Env.isBrowser() || !packet.data) return packet;

        try {
            // Use dynamic import for Node.js internals
            const zlib = await import('node:zlib');
            const compressed = zlib.gzipSync(JSON.stringify(packet.data));
            return {
                ...packet,
                data: compressed,
                meta: { ...packet.meta, compressed: true }
            } as MeshPacket;
        } catch {
            return packet;
        }
    }

    async onInbound(packet: MeshPacket): Promise<MeshPacket> {
        if (Env.isBrowser() || !packet.meta?.compressed || !packet.data) return packet;

        try {
            const zlib = await import('node:zlib');
            const decompressed = zlib.gunzipSync(packet.data as Buffer);
            return {
                ...packet,
                data: JSON.parse(decompressed.toString()),
                meta: { ...packet.meta, compressed: false }
            } as MeshPacket;
        } catch {
            return packet;
        }
    }
}
