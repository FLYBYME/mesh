import { z } from 'zod';
import { defineEvent } from '../interfaces/IEventContract.js';

/**
 * A direct transport link between two nodes came up or went down, reported by the node on one end
 * (`nodeID`) about the node on the other (`peer`). Both ends report their own view, so a link going
 * down between two live nodes arrives twice -- and a node that died reports nothing, so its links
 * are reported down only by the nodes that were linked to it.
 *
 * Global: the fleet belongs to the deployment, not to a tenant. Exposed at an operator gate, this is
 * what replaces reading a node's link state off `ss` over SSH.
 */
export const meshLinkChangedSchema = z.object({
    nodeID: z.string().describe('The node reporting'),
    peer: z.string().describe('The node at the other end of the link'),
    state: z.enum(['up', 'down']),
    at: z.number().describe('When it happened on the reporting node (epoch ms)'),
});

export const meshLinkChangedEvent = defineEvent('mesh.link.changed', meshLinkChangedSchema, { scopedBy: 'global' });

export type MeshLinkChanged = z.infer<typeof meshLinkChangedSchema>;

declare global {
    interface EventRegistry {
        'mesh.link.changed': MeshLinkChanged;
    }
}
