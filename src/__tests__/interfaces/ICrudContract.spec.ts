import { z } from 'zod';
import { defineCrud, CrudParamsSchema } from '../../interfaces/ICrudContract.js';

describe('ICrudContract — defineCrud', () => {
    const TestSchema = z.object({
        name: z.string(),
        value: z.number(),
        createdAt: z.coerce.date(),
        updatedAt: z.coerce.date(),
    });

    // ─── basic contract generation ──────────────────────────────────────────

    describe('defineCrud()', () => {
        it('should generate all standard CRUD contracts', () => {
            const crud = defineCrud('item', TestSchema, { dependencies: [] });

            expect(crud.domain).toBe('item');
            expect(crud.idField).toBe('id');
            expect(crud.find).toBeDefined();
            expect(crud.findOne).toBeDefined();
            expect(crud.count).toBeDefined();
            expect(crud.get).toBeDefined();
            expect(crud.create).toBeDefined();
            expect(crud.createMany).toBeDefined();
            expect(crud.update).toBeDefined();
            expect(crud.replace).toBeDefined();
            expect(crud.delete).toBeDefined();
            expect(crud.resolve).toBeDefined();
        });

        it('should set correct action names', () => {
            const crud = defineCrud('item', TestSchema, { dependencies: [] });

            expect(crud.find.action).toBe('find');
            expect(crud.findOne.action).toBe('find_one');
            expect(crud.count.action).toBe('count');
            expect(crud.get.action).toBe('get');
            expect(crud.create.action).toBe('create');
            expect(crud.update.action).toBe('update');
            expect(crud.delete.action).toBe('delete');
        });

        it('should set correct domain on all contracts', () => {
            const crud = defineCrud('widget', TestSchema, { dependencies: [] });
            const actions = ['find', 'findOne', 'count', 'get', 'create', 'createMany', 'update', 'replace', 'delete', 'resolve'] as const;

            for (const action of actions) {
                expect(crud[action].domain).toBe('widget');
            }
        });
    });

    // ─── REST routes ────────────────────────────────────────────────────────

    describe('REST route generation', () => {
        it('should generate correct REST paths using plural', () => {
            const crud = defineCrud('item', TestSchema, { dependencies: [] });

            expect(crud.find.rest.method).toBe('GET');
            expect(crud.find.rest.path).toBe('/items');
            expect(crud.findOne.rest.method).toBe('GET');
            expect(crud.findOne.rest.path).toBe('/items/one');
            expect(crud.create.rest.method).toBe('POST');
            expect(crud.create.rest.path).toBe('/items');
            expect(crud.get.rest.method).toBe('GET');
            expect(crud.get.rest.path).toBe('/items/:id');
            expect(crud.delete.rest.method).toBe('DELETE');
            expect(crud.delete.rest.path).toBe('/items/:id');
        });

        it('should use custom plural path', () => {
            const crud = defineCrud('person', TestSchema, { pluralPath: 'people', dependencies: [] });
            expect(crud.find.rest.path).toBe('/people');
        });
    });

    // ─── schema shapes ──────────────────────────────────────────────────────

    describe('schema shapes', () => {
        it('should include id, createdAt, updatedAt in output schema', () => {
            const crud = defineCrud('item', TestSchema, { dependencies: [] });
            const outputShape = (crud.outputSchema as z.ZodObject<z.ZodRawShape>).shape;

            expect(outputShape.id).toBeDefined();
            expect(outputShape.createdAt).toBeDefined();
            expect(outputShape.updatedAt).toBeDefined();
            expect(outputShape.name).toBeDefined();
            expect(outputShape.value).toBeDefined();
        });

        it('should throw if id field is in the base schema', () => {
            const BadSchema = z.object({
                id: z.string(),
                name: z.string(),
                createdAt: z.coerce.date(),
                updatedAt: z.coerce.date(),
            });

            expect(() => defineCrud('bad', BadSchema, { dependencies: [] })).toThrow('must NOT be defined');
        });
    });

    // ─── CrudParamsSchema ────────────────────────────────────────────────────

    describe('CrudParamsSchema', () => {
        it('should accept all standard query parameters', () => {
            const params = CrudParamsSchema.parse({
                limit: 10,
                offset: 5,
                fields: ['name', 'value'],
                sort: '-createdAt',
                search: 'test',
                query: { name: 'foo' }
            });

            expect(params.limit).toBe(10);
            expect(params.offset).toBe(5);
            expect(params.search).toBe('test');
        });

        it('should make all params optional and use defaults', () => {
            const params = CrudParamsSchema.parse({});
            expect(params.limit).toBe(100);
            expect(params.offset).toBe(0);
        });
    });

    // ─── custom action names ────────────────────────────────────────────────

    describe('custom options', () => {
        it('should support custom action names', () => {
            const crud = defineCrud('item', TestSchema, {
                dependencies: [],
                actions: { find: 'search', create: 'add' }
            });
            expect(crud.find.action).toBe('search');
            expect(crud.create.action).toBe('add');
        });

        it('should support custom id field', () => {
            const crud = defineCrud('item', TestSchema, { idField: 'itemId', dependencies: [] });
            expect(crud.idField).toBe('itemId');
        });
    });
});
