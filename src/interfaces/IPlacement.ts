import type { ToolContract } from './IToolContract.js';
import type { z } from 'zod';

/**
 * IPlacement -- what to do when a call arrives for a contract nothing in the cluster serves.
 *
 * `ServiceBroker` knows a tool is unreachable; it cannot know what to do about it. A contract
 * declares `filePath`, but turning that into something loadable is entirely a question about how a
 * given deployment stores and ships code (`mesh-serve` has precompiled core parts, a
 * content-addressed artifact store, and `serve.part.start`; another host would have none of that).
 * So the decision is pluggable and the retry is not.
 *
 * **A provider must address its own calls explicitly** -- `ctx.call(tool, params, { nodeID })`, or
 * a contract it knows is already mounted locally. Placement runs from inside
 * `ServiceBroker.call()`'s "nobody serves this" branch, so a provider that makes an unaddressed
 * call for a tool that is itself unplaced would re-enter placement for it. The broker refuses to
 * re-enter for the *same* tool (it proceeds unplaced and lets the call fail honestly rather than
 * deadlocking), but a chain across several tools is the provider's to avoid.
 */
export interface IPlacement {
    /**
     * Make `toolName` callable, and return the node it now lives on -- or `undefined` to say "I
     * can't", which lets the call fail with the ordinary "no node advertises this" error.
     *
     * `contract` is whatever `globalContractRegistry` knows about the tool, which may be nothing:
     * a node can be asked for a contract whose module it has never imported. That case is
     * genuinely undecidable from here and should return `undefined`.
     *
     * Called at most once at a time per tool name; concurrent callers for the same tool share one
     * attempt rather than stampeding.
     */
    place(toolName: string, contract: ToolContract<z.ZodTypeAny, z.ZodTypeAny> | undefined): Promise<string | undefined>;
}
