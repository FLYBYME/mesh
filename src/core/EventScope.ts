import { globalEventRegistry } from '../interfaces/IEventContract.js';
import { globalCrudRegistry } from '../interfaces/ICrudContract.js';

/**
 * Who one occurrence of an event belongs to -- answered from the event's *definition*, the one
 * place that knows, and used everywhere an event crosses a boundary: an event handler's context
 * (which tenant its `ctx.db` acts for) and a streamed subscription (which subscribers may see it).
 *
 * - `{ scopedBy }` -- a dotted path into the payload naming the owning scope (a tenant id).
 * - `'global'` -- belongs to everyone; declared on purpose (`defineEvent(..., { scopedBy:
 *   'global' })`, or `defineCrud(..., { delivery: 'global' })`).
 * - `{ refusal }` -- known, and still cannot be narrowed to anyone; the sentence says why.
 * - `undefined` -- nothing here defines this event at all.
 *
 * **An event that cannot be scoped belongs to nobody.** None of these answers is ever reached by
 * failing to find something: `'global'` is only what someone typed.
 */
export type EventScope =
    | { readonly scopedBy: string }
    | 'global'
    | { readonly refusal: string };

export function eventScope(name: string): EventScope | undefined {
    const declared = globalEventRegistry.get(name);
    if (declared !== undefined) {
        if (declared.scopedBy === undefined) {
            return {
                refusal: 'its definition declares no scopedBy, so it can never be narrowed to anyone -- '
                    + 'an event that cannot be scoped is delivered to nobody',
            };
        }
        return declared.scopedBy === 'global' ? 'global' : { scopedBy: declared.scopedBy };
    }

    // A collection's own `created`/`updated`/`deleted`, which `CrudExecutor` emits without a
    // `defineEvent` of their own.
    const dot = name.lastIndexOf('.');
    if (dot <= 0) return undefined;
    const domain = name.slice(0, dot);
    const action = name.slice(dot + 1);
    if (action !== 'created' && action !== 'updated' && action !== 'deleted') return undefined;

    const crud = globalCrudRegistry.get(domain);
    if (crud === undefined) return undefined;
    if (crud.scopedBy !== undefined) return { scopedBy: crudPayloadPath(action, crud.scopedBy) };
    if (crud.delivery === 'global') return 'global';
    return {
        refusal: `collection "${domain}" declares neither scopedBy nor delivery: 'global', so its `
            + 'events can never be narrowed to anyone',
    };
}

/**
 * Where the row's scope field sits in each CRUD event's payload (`CrudExecutor`): a create carries
 * the row itself, an update carries `{ id, patch, item }`, a delete `{ id, <scopedBy> }`.
 */
function crudPayloadPath(action: 'created' | 'updated' | 'deleted', scopedBy: string): string {
    return action === 'updated' ? `item.${scopedBy}` : scopedBy;
}

/**
 * Reads a scope out of a payload by dotted path. Only a non-empty string counts: a missing field, or
 * one that is not a string, is a disagreement between the definition and the payload, and the safe
 * reading of a disagreement is "belongs to nobody" -- never "belongs to everybody".
 */
export function readScope(payload: unknown, path: string): string | undefined {
    let current: unknown = payload;
    for (const segment of path.split('.')) {
        if (typeof current !== 'object' || current === null || !(segment in current)) return undefined;
        current = Reflect.get(current, segment);
    }
    return typeof current === 'string' && current.length > 0 ? current : undefined;
}

/** Who one occurrence belongs to: everyone, one scope, or (`undefined`) nobody. */
export type OccurrenceScope = { readonly global: true } | { readonly scope: string };

export function scopeOfOccurrence(name: string, payload: unknown): OccurrenceScope | undefined {
    const scope = eventScope(name);
    if (scope === undefined) return undefined;
    if (scope === 'global') return { global: true };
    if ('refusal' in scope) return undefined;
    const owner = readScope(payload, scope.scopedBy);
    return owner === undefined ? undefined : { scope: owner };
}
