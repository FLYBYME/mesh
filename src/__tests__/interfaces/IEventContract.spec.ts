import { z } from 'zod';
import {
    defineEvent,
    EventContractRegistry,
    globalEventRegistry,
    DataCreatedSchema,
    DataDeletedSchema,
    DataUpdatedSchema,
    MeshStartedSchema,
    MeshStoppedSchema,
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

    // ─── 6. Auto-registration in globalEventRegistry ───────────────────────────

    describe('auto-registration in globalEventRegistry', () => {
        beforeEach(() => {
            globalEventRegistry.clear();
        });

        it('should auto-register defined event in globalEventRegistry', () => {
            expect(globalEventRegistry.has('cdn.site_deployed')).toBe(false);

            const SiteDeployedSchema = z.object({ siteId: z.string() });
            defineEvent('cdn.site_deployed', SiteDeployedSchema, { scopedBy: 'siteId' });

            expect(globalEventRegistry.has('cdn.site_deployed')).toBe(true);
            const entry = globalEventRegistry.get('cdn.site_deployed');
            expect(entry).toBeDefined();
            expect(entry?.name).toBe('cdn.site_deployed');
            expect(entry?.schema).toBe(SiteDeployedSchema);
            expect(entry?.scopedBy).toBe('siteId');
        });

        it('should register unscoped events with undefined scopedBy', () => {
            const PingSchema = z.object({ ping: z.boolean() });
            defineEvent('system.ping', PingSchema);

            const entry = globalEventRegistry.get('system.ping');
            expect(entry).toBeDefined();
            expect(entry?.name).toBe('system.ping');
            expect(entry?.scopedBy).toBeUndefined();
        });
    });

    // ─── 7. Decision: Duplicate names (first-wins dedup matching ContractRegistry) ──

    describe('Decision: Duplicate event names (first-wins matching ContractRegistry)', () => {
        let registry: EventContractRegistry;

        beforeEach(() => {
            registry = new EventContractRegistry();
        });

        it('should not overwrite an already registered event definition (first-wins)', () => {
            const SchemaV1 = z.object({ version: z.literal(1), orgId: z.string() });
            const SchemaV2 = z.object({ version: z.literal(2), orgId: z.string() });

            const event1 = { name: 'dup.event', schema: SchemaV1, scopedBy: 'orgId' };
            const event2 = { name: 'dup.event', schema: SchemaV2, scopedBy: 'global' };

            registry.register(event1);
            registry.register(event2);

            expect(registry.size).toBe(1);
            const registered = registry.get('dup.event');
            expect(registered?.schema).toBe(SchemaV1);
            expect(registered?.scopedBy).toBe('orgId');
        });

        it('should retain first registration when defineEvent is called twice with same name', () => {
            globalEventRegistry.clear();

            const SchemaA = z.object({ id: z.string() });
            const SchemaB = z.object({ otherId: z.string() });

            defineEvent('collide.event', SchemaA, { scopedBy: 'id' });
            defineEvent('collide.event', SchemaB, { scopedBy: 'otherId' });

            expect(globalEventRegistry.size).toBe(1);
            const registered = globalEventRegistry.get('collide.event');
            expect(registered?.schema).toBe(SchemaA);
            expect(registered?.scopedBy).toBe('id');
        });
    });

    // ─── 8. Decision: clear() resets registry state for test independence ───────

    describe('Decision: clear() resets registry state for test independence', () => {
        it('should clear all entries from an EventContractRegistry instance', () => {
            const registry = new EventContractRegistry();
            registry.register({ name: 'event.one', schema: z.object({}) });
            registry.register({ name: 'event.two', schema: z.object({}) });

            expect(registry.size).toBe(2);
            registry.clear();
            expect(registry.size).toBe(0);
            expect(registry.has('event.one')).toBe(false);
            expect(registry.get('event.one')).toBeUndefined();
        });

        it('should clear all entries from globalEventRegistry', () => {
            defineEvent('temp.cleared', z.object({}));
            expect(globalEventRegistry.has('temp.cleared')).toBe(true);

            globalEventRegistry.clear();
            expect(globalEventRegistry.size).toBe(0);
            expect(globalEventRegistry.has('temp.cleared')).toBe(false);
        });
    });

    // ─── 9. Decision: Built-in events are not registered in runtime registry ────

    describe('Decision: Built-in events are not registered in runtime registry', () => {
        beforeEach(() => {
            globalEventRegistry.clear();
        });

        it('should not register built-in mesh lifecycle events by default', () => {
            expect(globalEventRegistry.has('mesh.started')).toBe(false);
            expect(globalEventRegistry.get('mesh.started')).toBeUndefined();

            expect(globalEventRegistry.has('mesh.stopped')).toBe(false);
            expect(globalEventRegistry.get('mesh.stopped')).toBeUndefined();
        });

        it('should not register built-in data persistence events by default', () => {
            // Built-in data events (data.created, data.updated, data.deleted) cannot be statically scoped
            // and must never be exposed to browser streams. Registering them would falsely indicate exposability.
            expect(globalEventRegistry.has('data.created')).toBe(false);
            expect(globalEventRegistry.get('data.created')).toBeUndefined();

            expect(globalEventRegistry.has('data.updated')).toBe(false);
            expect(globalEventRegistry.get('data.updated')).toBeUndefined();

            expect(globalEventRegistry.has('data.deleted')).toBe(false);
            expect(globalEventRegistry.get('data.deleted')).toBeUndefined();
        });
    });

    // ─── 10. Decision: Return value of defineEvent is preserved ─────────────────

    describe('Decision: Return value of defineEvent is preserved', () => {
        it('should return exact EventDefinition shape without mutations for unscoped events', () => {
            const Schema = z.object({ count: z.number() });
            const result = defineEvent('count.changed', Schema);

            expect(result).toEqual({
                name: 'count.changed',
                schema: Schema
            });
            // Verify destructuring works as callers expect
            const { name, schema, scopedBy } = result;
            expect(name).toBe('count.changed');
            expect(schema).toBe(Schema);
            expect(scopedBy).toBeUndefined();
        });

        it('should return exact EventDefinition shape without mutations for scoped events', () => {
            const Schema = z.object({ tenantId: z.string(), count: z.number() });
            const result = defineEvent('count.tenant_changed', Schema, { scopedBy: 'tenantId' });

            expect(result).toEqual({
                name: 'count.tenant_changed',
                schema: Schema,
                scopedBy: 'tenantId'
            });
            const { name, schema, scopedBy } = result;
            expect(name).toBe('count.tenant_changed');
            expect(schema).toBe(Schema);
            expect(scopedBy).toBe('tenantId');
        });
    });

    // ─── 11. EventContractRegistry collection methods ──────────────────────────

    describe('EventContractRegistry collection methods', () => {
        let registry: EventContractRegistry;

        beforeEach(() => {
            registry = new EventContractRegistry();
        });

        it('should support entries(), values(), and size', () => {
            const ev1 = { name: 'domainA.event1', schema: z.object({}) };
            const ev2 = { name: 'domainA.event2', schema: z.object({}) };
            const ev3 = { name: 'domainB.event1', schema: z.object({}) };

            registry.register(ev1);
            registry.register(ev2);
            registry.register(ev3);

            expect(registry.size).toBe(3);

            const entries = [...registry.entries()];
            expect(entries).toHaveLength(3);
            expect(entries.map(([k]) => k)).toEqual(['domainA.event1', 'domainA.event2', 'domainB.event1']);

            const values = [...registry.values()];
            expect(values).toHaveLength(3);
            expect(values.map(v => v.name)).toEqual(['domainA.event1', 'domainA.event2', 'domainB.event1']);
        });

        it('should support byDomain() filtering', () => {
            registry.register({ name: 'billing.invoice_created', schema: z.object({}) });
            registry.register({ name: 'billing.payment_received', schema: z.object({}) });
            registry.register({ name: 'auth.user_logged_in', schema: z.object({}) });

            const billingEvents = registry.byDomain('billing');
            expect(billingEvents).toHaveLength(2);
            expect(billingEvents.map(e => e.name)).toEqual([
                'billing.invoice_created',
                'billing.payment_received'
            ]);

            const authEvents = registry.byDomain('auth');
            expect(authEvents).toHaveLength(1);
            expect(authEvents[0].name).toBe('auth.user_logged_in');

            const emptyEvents = registry.byDomain('nonexistent');
            expect(emptyEvents).toEqual([]);
        });
    });
});

