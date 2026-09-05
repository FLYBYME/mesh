import { z } from 'zod';
import {
    defineEvent,
    DataCreatedSchema,
    DataDeletedSchema,
    DataUpdatedSchema,
    type EventDefinition
} from '../../interfaces/IEventContract.js';

describe('IEventContract — defineEvent', () => {
    const ZoneCreatedSchema = z.object({
        organizationId: z.string(),
        zoneName: z.string(),
        createdAt: z.date()
    });

    // ─── 1. Basic event definition & regression safety ─────────────────────────

    describe('basic definition & regression safety', () => {
        it('should define an event with name and schema when options are omitted', () => {
            const event = defineEvent('domains.zone_created', ZoneCreatedSchema);

            expect(event.name).toBe('domains.zone_created');
            expect(event.schema).toBe(ZoneCreatedSchema);
            expect(event.scopedBy).toBeUndefined();
        });

        it('should record scopedBy when explicitly provided', () => {
            const event = defineEvent('domains.zone_created', ZoneCreatedSchema, {
                scopedBy: 'organizationId'
            });

            expect(event.name).toBe('domains.zone_created');
            expect(event.schema).toBe(ZoneCreatedSchema);
            expect(event.scopedBy).toBe('organizationId');
        });
    });

    // ─── 2. Decision 1: Omitted scopedBy means unscopable, never global ─────────

    describe('Decision 1: Omitted scopedBy means unscopable (never global)', () => {
        it('should have undefined scopedBy when options are not provided', () => {
            const event = defineEvent('domains.zone_created', ZoneCreatedSchema);
            expect(event.scopedBy).toBeUndefined();
            expect(event.scopedBy).not.toBe('global');
        });

        it('should have undefined scopedBy when options is an empty object', () => {
            const event = defineEvent('domains.zone_created', ZoneCreatedSchema, {});
            expect(event.scopedBy).toBeUndefined();
            expect(event.scopedBy).not.toBe('global');
        });

        it('should have undefined scopedBy when scopedBy is explicitly undefined', () => {
            const event = defineEvent('domains.zone_created', ZoneCreatedSchema, { scopedBy: undefined });
            expect(event.scopedBy).toBeUndefined();
            expect(event.scopedBy).not.toBe('global');
        });

        it('should require explicit "global" to declare universal delivery', () => {
            const GlobalSchema = z.object({ message: z.string() });
            const event = defineEvent('system.maintenance', GlobalSchema, { scopedBy: 'global' });
            expect(event.scopedBy).toBe('global');
        });
    });

    // ─── 3. Decision 2: Nested fields (dotted paths) ───────────────────────────

    describe('Decision 2: Nested fields (dotted paths)', () => {
        const NestedSchema = z.object({
            site: z.object({
                tenantId: z.string(),
                name: z.string()
            }),
            action: z.string()
        });

        const DeeplyNestedSchema = z.object({
            account: z.object({
                organization: z.object({
                    id: z.string()
                })
            })
        });

        it('should support a dotted path for nested payload structures', () => {
            const event = defineEvent('site.updated', NestedSchema, {
                scopedBy: 'site.tenantId'
            });
            expect(event.scopedBy).toBe('site.tenantId');
        });

        it('should support deeply nested dotted paths', () => {
            const event = defineEvent('account.changed', DeeplyNestedSchema, {
                scopedBy: 'account.organization.id'
            });
            expect(event.scopedBy).toBe('account.organization.id');
        });

        it('should traverse through optional and nullable nested objects', () => {
            const OptionalNestedSchema = z.object({
                site: z.object({
                    tenantId: z.string()
                }).optional()
            });

            const event = defineEvent('site.maybe_updated', OptionalNestedSchema, {
                scopedBy: 'site.tenantId'
            });
            expect(event.scopedBy).toBe('site.tenantId');
        });

        it('should traverse through intersections', () => {
            const IntersectionSchema = z.intersection(
                z.object({ metadata: z.string() }),
                z.object({ tenant: z.object({ id: z.string() }) })
            );

            const event = defineEvent('intersected.event', IntersectionSchema, {
                scopedBy: 'tenant.id'
            });
            expect(event.scopedBy).toBe('tenant.id');
        });

        it('should refuse a dotted path when an intermediate segment is missing', () => {
            expect(() => {
                defineEvent('site.updated', NestedSchema, { scopedBy: 'missing.tenantId' });
            }).toThrow(
                'defineEvent Error: The scopedBy field "missing.tenantId" must be defined in the Zod schema for event "site.updated". Scoped events require a field in their schema to identify the recipient scope.'
            );
        });

        it('should refuse a dotted path when a leaf segment is missing', () => {
            expect(() => {
                defineEvent('site.updated', NestedSchema, { scopedBy: 'site.missingField' });
            }).toThrow(
                'defineEvent Error: The scopedBy field "site.missingField" must be defined in the Zod schema for event "site.updated". Scoped events require a field in their schema to identify the recipient scope.'
            );
        });

        it('should refuse a dotted path that attempts to index into a primitive property', () => {
            expect(() => {
                defineEvent('site.updated', NestedSchema, { scopedBy: 'site.tenantId.leaf' });
            }).toThrow(
                'defineEvent Error: The scopedBy field "site.tenantId.leaf" must be defined in the Zod schema for event "site.updated". Scoped events require a field in their schema to identify the recipient scope.'
            );
        });

        it('should refuse a dotted path containing empty segments', () => {
            expect(() => {
                defineEvent('site.updated', NestedSchema, { scopedBy: 'site.' });
            }).toThrow('defineEvent Error: scopedBy path "site." for event "site.updated" contains empty segments.');

            expect(() => {
                defineEvent('site.updated', NestedSchema, { scopedBy: '.tenantId' });
            }).toThrow('defineEvent Error: scopedBy path ".tenantId" for event "site.updated" contains empty segments.');

            expect(() => {
                defineEvent('site.updated', NestedSchema, { scopedBy: 'site..tenantId' });
            }).toThrow('defineEvent Error: scopedBy path "site..tenantId" for event "site.updated" contains empty segments.');
        });
    });

    // ─── 4. Decision 3: Schema validation & typo refusal ───────────────────────

    describe('Decision 3: Schema validation & typo refusal', () => {
        it('should throw when scopedBy field does not exist in schema (typo protection)', () => {
            expect(() => {
                defineEvent('domains.zone_created', ZoneCreatedSchema, {
                    scopedBy: 'organisationId' // typo: s instead of z
                });
            }).toThrow(
                'defineEvent Error: The scopedBy field "organisationId" must be defined in the Zod schema for event "domains.zone_created". Scoped events require a field in their schema to identify the recipient scope.'
            );
        });

        it('should throw when schema is a primitive and scopedBy is a field path', () => {
            const PrimitiveSchema = z.string();
            expect(() => {
                defineEvent('primitive.event', PrimitiveSchema, {
                    scopedBy: 'organizationId'
                });
            }).toThrow(
                'defineEvent Error: The scopedBy field "organizationId" must be defined in the Zod schema for event "primitive.event". Scoped events require a field in their schema to identify the recipient scope.'
            );
        });

        it('should throw when scopedBy is an empty string or whitespace', () => {
            expect(() => {
                defineEvent('domains.zone_created', ZoneCreatedSchema, { scopedBy: '' });
            }).toThrow('defineEvent Error: scopedBy option for event "domains.zone_created" must be a non-empty string.');

            expect(() => {
                defineEvent('domains.zone_created', ZoneCreatedSchema, { scopedBy: '   ' });
            }).toThrow('defineEvent Error: scopedBy option for event "domains.zone_created" must be a non-empty string.');
        });

        it('should allow "global" even if the schema does not have a "global" property', () => {
            const event = defineEvent('domains.zone_created', ZoneCreatedSchema, {
                scopedBy: 'global'
            });
            expect(event.scopedBy).toBe('global');
        });

        it('should validate unions: succeeds only if scopedBy is present in all branches', () => {
            const ValidUnionSchema = z.union([
                z.object({ type: z.literal('A'), tenantId: z.string() }),
                z.object({ type: z.literal('B'), tenantId: z.string() })
            ]);

            const event = defineEvent('union.event', ValidUnionSchema, { scopedBy: 'tenantId' });
            expect(event.scopedBy).toBe('tenantId');

            const IncompleteUnionSchema = z.union([
                z.object({ type: z.literal('A'), tenantId: z.string() }),
                z.object({ type: z.literal('B') }) // missing tenantId
            ]);

            expect(() => {
                defineEvent('union.event', IncompleteUnionSchema, { scopedBy: 'tenantId' });
            }).toThrow(
                'defineEvent Error: The scopedBy field "tenantId" must be defined in the Zod schema for event "union.event". Scoped events require a field in their schema to identify the recipient scope.'
            );
        });

        it('should validate discriminated unions: succeeds only if scopedBy is present in all branches', () => {
            const ValidDiscriminatedUnion = z.discriminatedUnion('kind', [
                z.object({ kind: z.literal('create'), orgId: z.string() }),
                z.object({ kind: z.literal('delete'), orgId: z.string() })
            ]);

            const event = defineEvent('du.event', ValidDiscriminatedUnion, { scopedBy: 'orgId' });
            expect(event.scopedBy).toBe('orgId');

            const IncompleteDiscriminatedUnion = z.discriminatedUnion('kind', [
                z.object({ kind: z.literal('create'), orgId: z.string() }),
                z.object({ kind: z.literal('delete') }) // missing orgId
            ]);

            expect(() => {
                defineEvent('du.event', IncompleteDiscriminatedUnion, { scopedBy: 'orgId' });
            }).toThrow(
                'defineEvent Error: The scopedBy field "orgId" must be defined in the Zod schema for event "du.event". Scoped events require a field in their schema to identify the recipient scope.'
            );
        });
    });

    // ─── 5. Decision 4: Generic data events cannot be scoped ───────────────────

    describe('Decision 4: Generic data events cannot be scoped', () => {
        it('should reject scoping data.created by item.<field> because item is a generic Record', () => {
            // DataCreatedSchema has item: z.record(z.string(), z.unknown()).
            // Because the record does not statically define domain-specific scoping keys,
            // defineEvent correctly refuses to validate it, preventing false scoping guarantees.
            expect(() => {
                defineEvent('data.created', DataCreatedSchema, {
                    scopedBy: 'item.organizationId'
                });
            }).toThrow(
                'defineEvent Error: The scopedBy field "item.organizationId" must be defined in the Zod schema for event "data.created". Scoped events require a field in their schema to identify the recipient scope.'
            );
        });

        it('should reject scoping data.updated by item.<field> for the same reason', () => {
            expect(() => {
                defineEvent('data.updated', DataUpdatedSchema, {
                    scopedBy: 'item.tenantId'
                });
            }).toThrow(
                'defineEvent Error: The scopedBy field "item.tenantId" must be defined in the Zod schema for event "data.updated". Scoped events require a field in their schema to identify the recipient scope.'
            );
        });

        it('should reject scoping data.deleted because it contains no item payload at all', () => {
            // data.deleted only has { domain, id }.
            expect(() => {
                defineEvent('data.deleted', DataDeletedSchema, {
                    scopedBy: 'tenantId'
                });
            }).toThrow(
                'defineEvent Error: The scopedBy field "tenantId" must be defined in the Zod schema for event "data.deleted". Scoped events require a field in their schema to identify the recipient scope.'
            );
        });
    });
});
