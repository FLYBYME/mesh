import { z } from 'zod';
import { defineCrud } from '../interfaces/ICrudContract.js';

describe('ICrudContract', () => {
    const TestBaseSchema = z.object({
        name: z.string(),
        age: z.number()
    });

    describe('defineCrud()', () => {
        it('should generate all standard CRUD contracts', () => {
            const crud = defineCrud('user', TestBaseSchema);

            expect(crud.domain).toBe('user');
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

        it('should ensure all generated contracts have isCrud: true and correct domain', () => {
            const crud = defineCrud('user', TestBaseSchema);

            const actions = ['find', 'findOne', 'count', 'get', 'create', 'createMany', 'update', 'replace', 'delete', 'resolve'] as const;
            for (const action of actions) {
                const contract = crud[action];
                expect(contract.isCrud).toBe(true);
                expect(contract.domain).toBe('user');
            }
        });

        it('should throw an error if the idField is defined in the baseSchema', () => {
            const BadSchema = z.object({
                id: z.string(), // Not allowed
                name: z.string()
            });

            expect(() => {
                defineCrud('bad', BadSchema);
            }).toThrow('must NOT be defined in the Zod baseSchema');
        });

        it('should allow custom idField without conflict', () => {
            const crud = defineCrud('item', TestBaseSchema, { idField: 'uuid' });

            expect(crud.idField).toBe('uuid');

            // Check that output schema includes the new id field
            const testObj = { uuid: '123', name: 'test', age: 10, createdAt: new Date(), updatedAt: new Date() };
            expect(() => crud.outputSchema.parse(testObj)).not.toThrow();
        });

        it('should allow custom action names via options.actions', () => {
            const crud = defineCrud('user', TestBaseSchema, {
                actions: { create: 'make' }
            });

            expect(crud.create.action).toBe('make');
            expect(crud.find.action).toBe('find'); // Default still present
        });

        it('should omit auto-generated fields from CreateInputSchema', () => {
            const crud = defineCrud('user', TestBaseSchema);
            const createSchema = crud.create.inputSchema as any;

            // Should require name and age
            expect(() => createSchema.parse({ name: 'Bob', age: 30 })).not.toThrow();

            // Should strip or ignore id/createdAt/updatedAt
            // Zod's parse behaves differently depending on exact construction, but
            // essentially it won't *require* them.
            expect(() => createSchema.parse({ name: 'Bob' })).toThrow(); // missing age
        });
    });
});
