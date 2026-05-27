import { z } from 'zod';
import { defineContract, ToolContract, defaultPrint } from './IToolContract.js';

// --- Type Helpers ---
type Prettify<T> = { [K in keyof T]: T[K] } & { [K in keyof T as never]: T[K] };
type OmittedFields = 'id' | '_id' | 'createdAt' | 'updatedAt';

type CreateIn<TBaseIn, TId extends string> = Prettify<Omit<TBaseIn, OmittedFields>> & { [K in TId as never]: string };
type UpdateIn<TBaseIn, TId extends string> = Prettify<Partial<Omit<TBaseIn, OmittedFields>> & { [K in TId]: string }>;
type ReplaceIn<TBaseIn, TId extends string> = Prettify<Omit<TBaseIn, OmittedFields> & { [K in TId]: string }>;
type IdOnlyIn<TId extends string> = Prettify<{ [K in TId]: string }>;

export interface RelationDefinition {
    localField: string;
    foreignCollection: string;
    foreignField: string;
    as: string;
    isMany: boolean;
}

/**
 * CrudParamsSchema: Standard parameters for queries.
 */
export const CrudParamsSchema = z.object({
    limit: z.number().optional().describe("Max count of rows."),
    offset: z.number().optional().describe("Number of skipped rows."),
    fields: z.union([z.string(), z.array(z.string())]).optional().describe("Fields to return."),
    sort: z.union([z.string(), z.array(z.string())]).optional().describe("Sorted fields. Use '-' prefix for descending."),
    search: z.string().optional().describe("Search text."),
    searchFields: z.union([z.string(), z.array(z.string())]).optional().describe("Fields for search."),
    query: z.record(z.string(), z.unknown()).optional().describe("Query object."),
    populate: z.union([z.string(), z.array(z.string())]).optional().describe("Populated fields."),
});

/**
 * AnyCrudContracts: Generic base for any CRUD contract set.
 * Allows the framework to consume CRUD sets without knowing the exact schemas.
 */
export interface AnyCrudContracts extends Record<string, unknown> {
    readonly domain: string;
    readonly idField: string;
    readonly find: ToolContract<z.ZodTypeAny, z.ZodTypeAny, never>;
    readonly findOne: ToolContract<z.ZodTypeAny, z.ZodTypeAny, never>;
    readonly count: ToolContract<z.ZodTypeAny, z.ZodTypeAny, never>;
    readonly get: ToolContract<z.ZodTypeAny, z.ZodTypeAny, never>;
    readonly create: ToolContract<z.ZodTypeAny, z.ZodTypeAny, never>;
    readonly update: ToolContract<z.ZodTypeAny, z.ZodTypeAny, never>;
    readonly delete: ToolContract<z.ZodTypeAny, z.ZodTypeAny, never>;
    readonly replace?: ToolContract<z.ZodTypeAny, z.ZodTypeAny, never>;
    readonly resolve?: ToolContract<z.ZodTypeAny, z.ZodTypeAny, never>;
    readonly createMany?: ToolContract<z.ZodTypeAny, z.ZodTypeAny, never>;
}

export type CrudContracts<
    TBase extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>,
    TIdField extends string = 'id',
    TOut extends z.ZodObject<
        z.ZodRawShape,
        z.UnknownKeysParam,
        z.ZodTypeAny,
        Prettify<Omit<z.output<TBase>, TIdField | 'createdAt' | 'updatedAt'> & { [K in TIdField]: string } & { createdAt: Date; updatedAt: Date }>,
        Prettify<Omit<z.input<TBase>, TIdField | 'createdAt' | 'updatedAt'> & { [K in TIdField]: string } & { createdAt: Date; updatedAt: Date }>
    > = z.ZodObject<
        Omit<TBase['shape'], TIdField | 'createdAt' | 'updatedAt'> & { [K in TIdField]: z.ZodString } & { createdAt: z.ZodDate; updatedAt: z.ZodDate },
        z.UnknownKeysParam,
        z.ZodTypeAny,
        Prettify<Omit<z.output<TBase>, TIdField | 'createdAt' | 'updatedAt'> & { [K in TIdField]: string } & { createdAt: Date; updatedAt: Date }>,
        Prettify<Omit<z.input<TBase>, TIdField | 'createdAt' | 'updatedAt'> & { [K in TIdField]: string } & { createdAt: Date; updatedAt: Date }>
    >,
    TCreate extends z.ZodTypeAny = z.ZodTypeAny,
    TUpdate extends z.ZodTypeAny = z.ZodTypeAny,
    TReplace extends z.ZodTypeAny = z.ZodTypeAny,
    TGet extends z.ZodTypeAny = z.ZodTypeAny,
    TFind extends z.ZodTypeAny = z.ZodTypeAny,
    TFindOne extends z.ZodTypeAny = z.ZodTypeAny,
    TResolve extends z.ZodTypeAny = z.ZodTypeAny,
    TDelete extends z.ZodTypeAny = z.ZodTypeAny
> = {
    readonly domain: string;
    readonly idField: TIdField;
    readonly baseSchema: TBase;
    readonly outputSchema: TOut;
    readonly relations: RelationDefinition[];

    readonly find: ToolContract<TFind, z.ZodArray<TOut>>;
    readonly findOne: ToolContract<TFindOne, z.ZodOptional<TOut>>;
    readonly count: ToolContract<z.ZodObject<Pick<typeof CrudParamsSchema.shape, 'search' | 'searchFields' | 'query'>>, z.ZodNumber>;
    readonly get: ToolContract<TGet, TOut>;
    readonly resolve: ToolContract<TResolve, z.ZodUnion<[z.ZodArray<TOut>, z.ZodRecord<z.ZodString, TOut>]>>;

    readonly create: ToolContract<TCreate, TOut>;
    readonly createMany: ToolContract<z.ZodArray<TCreate>, z.ZodArray<TOut>>;
    readonly update: ToolContract<TUpdate, TOut>;
    readonly replace: ToolContract<TReplace, TOut>;
    readonly delete: ToolContract<TDelete, z.ZodObject<{ success: z.ZodBoolean }>>;
};

export function defineCrud<
    TShape extends z.ZodRawShape,
    TBase extends z.ZodObject<TShape>,
    const TIdField extends string = 'id',
    TOut extends z.ZodObject<
        z.ZodRawShape,
        z.UnknownKeysParam,
        z.ZodTypeAny,
        Prettify<Omit<z.output<TBase>, TIdField | 'createdAt' | 'updatedAt'> & { [K in TIdField]: string } & { createdAt: Date; updatedAt: Date }>,
        Prettify<Omit<z.input<TBase>, TIdField | 'createdAt' | 'updatedAt'> & { [K in TIdField]: string } & { createdAt: Date; updatedAt: Date }>
    > = z.ZodObject<
        Omit<TShape, TIdField | 'createdAt' | 'updatedAt'> & { [K in TIdField]: z.ZodString } & { createdAt: z.ZodDate; updatedAt: z.ZodDate },
        z.UnknownKeysParam,
        z.ZodTypeAny,
        Prettify<Omit<z.output<TBase>, TIdField | 'createdAt' | 'updatedAt'> & { [K in TIdField]: string } & { createdAt: Date; updatedAt: Date }>,
        Prettify<Omit<z.input<TBase>, TIdField | 'createdAt' | 'updatedAt'> & { [K in TIdField]: string } & { createdAt: Date; updatedAt: Date }>
    >
>(
    domain: string,
    baseSchema: TBase,
    options: {
        pluralPath?: string;
        idField?: TIdField;
        outputSchema?: z.ZodObject<z.ZodRawShape>;
        relations?: RelationDefinition[];
        actions?: Partial<Record<keyof Omit<CrudContracts<TBase, TIdField, TOut>, 'domain' | 'baseSchema' | 'outputSchema' | 'relations'>, string>>,
        events?: Partial<Record<keyof Omit<CrudContracts<TBase, TIdField, TOut>, 'domain' | 'baseSchema' | 'outputSchema' | 'relations'>, string | boolean>>,
        destructive?: Partial<Record<keyof Omit<CrudContracts<TBase, TIdField, TOut>, 'domain' | 'baseSchema' | 'outputSchema' | 'relations'>, boolean>>
    } = {}
): CrudContracts<
    TBase,
    TIdField,
    TOut,
    z.ZodType<CreateIn<z.output<TBase>, TIdField>, z.ZodTypeDef, CreateIn<z.input<TBase>, TIdField>>,
    z.ZodType<UpdateIn<z.output<TBase>, TIdField>, z.ZodTypeDef, UpdateIn<z.input<TBase>, TIdField>>,
    z.ZodType<ReplaceIn<z.output<TBase>, TIdField>, z.ZodTypeDef, ReplaceIn<z.input<TBase>, TIdField>>,
    z.ZodType<Prettify<IdOnlyIn<TIdField> & z.input<typeof CrudParamsSchema>>, z.ZodTypeDef, Prettify<IdOnlyIn<TIdField> & z.input<typeof CrudParamsSchema>>>,
    typeof CrudParamsSchema,
    typeof CrudParamsSchema,
    z.ZodType<Prettify<{ [K in TIdField]: string | string[] } & z.input<typeof CrudParamsSchema> & { mapping?: boolean, throwIfNotExist?: boolean, reorderResult?: boolean }>, z.ZodTypeDef, Prettify<{ [K in TIdField]: string | string[] } & z.input<typeof CrudParamsSchema> & { mapping?: boolean, throwIfNotExist?: boolean, reorderResult?: boolean }>>,
    z.ZodType<IdOnlyIn<TIdField>, z.ZodTypeDef, IdOnlyIn<TIdField>>
> {
    const plural = options.pluralPath || `${domain}s`;
    const idField = options.idField || ('id' as TIdField);
    if (idField in baseSchema.shape) {
        throw new Error(`defineCrud Error: The ID field "${String(idField)}" must NOT be defined in the Zod baseSchema shape for domain "${domain}". Document IDs are handled automatically by the database layer.`);
    }
    const outputSchema = options.outputSchema || (baseSchema.extend({
        [idField]: z.string(),
        createdAt: z.coerce.date(),
        updatedAt: z.coerce.date()
    } as unknown as Record<string, z.ZodTypeAny>) as unknown as TOut);
    const relations = options.relations || [];

    const actionNames = {
        find: 'find', findOne: 'find_one', count: 'count', get: 'get', resolve: 'resolve',
        create: 'create', createMany: 'create_many', update: 'update',
        replace: 'replace', delete: 'delete', ...options.actions
    };

    const eventNames = {
        create: 'created', createMany: 'created_many', update: 'updated',
        replace: 'replaced', delete: 'deleted', ...options.events
    };

    const destructive = {
        find: false, findOne: false, count: false, get: false, resolve: false,
        create: true, createMany: true, update: true, replace: true, delete: true,
        ...options.destructive
    };

    // --- Input Schemas ---
    const rawBase = baseSchema as unknown as z.ZodObject<z.ZodRawShape>;

    const CreateInputSchema = rawBase
        .omit({ id: true, _id: true, createdAt: true, updatedAt: true } as Record<string, true>) as unknown as z.ZodType<
            CreateIn<z.output<TBase>, TIdField>,
            z.ZodTypeDef,
            CreateIn<z.input<TBase>, TIdField>
        >;

    const UpdateInputSchema = rawBase
        .partial()
        .extend({ [idField]: z.string() } as Record<string, z.ZodTypeAny>) as unknown as z.ZodType<
            UpdateIn<z.output<TBase>, TIdField>,
            z.ZodTypeDef,
            UpdateIn<z.input<TBase>, TIdField>
        >;

    const ReplaceInputSchema = rawBase
        .extend({ [idField]: z.string() } as Record<string, z.ZodTypeAny>) as unknown as z.ZodType<
            ReplaceIn<z.output<TBase>, TIdField>,
            z.ZodTypeDef,
            ReplaceIn<z.input<TBase>, TIdField>
        >;

    const IdInputSchema = z.object({
        [idField]: z.string()
    } as Record<string, z.ZodTypeAny>) as unknown as z.ZodType<
        IdOnlyIn<TIdField>,
        z.ZodTypeDef,
        IdOnlyIn<TIdField>
    >;

    const GetInputSchema = (z.object({ [idField]: z.string() } as Record<string, z.ZodTypeAny>) as z.ZodObject<z.ZodRawShape>).extend(CrudParamsSchema.shape) as unknown as z.ZodType<
        Prettify<IdOnlyIn<TIdField> & z.input<typeof CrudParamsSchema>>,
        z.ZodTypeDef,
        Prettify<IdOnlyIn<TIdField> & z.input<typeof CrudParamsSchema>>
    >;

    const ResolveInputSchema = z.object({
        [idField]: z.union([z.string(), z.array(z.string())]),
        ...CrudParamsSchema.shape,
        mapping: z.boolean().optional(),
        throwIfNotExist: z.boolean().optional(),
        reorderResult: z.boolean().optional(),
    } as Record<string, z.ZodTypeAny>) as unknown as z.ZodType<
        Prettify<{ [K in TIdField]: string | string[] } & z.input<typeof CrudParamsSchema> & { mapping?: boolean, throwIfNotExist?: boolean, reorderResult?: boolean }>,
        z.ZodTypeDef,
        Prettify<{ [K in TIdField]: string | string[] } & z.input<typeof CrudParamsSchema> & { mapping?: boolean, throwIfNotExist?: boolean, reorderResult?: boolean }>
    >;

    const FindInputSchema = CrudParamsSchema;
    const FindOneInputSchema = CrudParamsSchema;

    const ResolveOutputSchema = z.union([z.array(outputSchema), z.record(z.string(), outputSchema)]);

    // --- Contracts ---

    const findContract = defineContract({
        domain, action: actionNames.find,
        description: `Find ${plural} by query.`,
        inputSchema: FindInputSchema,
        outputSchema: z.array(outputSchema),
        rest: { method: 'GET', path: `/${plural}` },
        destructive: destructive.find, event: eventNames.find,
        isCrud: true,
        print: defaultPrint
    });

    const findOneContract = defineContract({
        domain, action: actionNames.findOne,
        description: `Find a single ${domain} by query.`,
        inputSchema: FindOneInputSchema,
        outputSchema: outputSchema.optional(),
        rest: { method: 'GET', path: `/${plural}/one` },
        destructive: destructive.findOne, event: eventNames.findOne,
        isCrud: true,
        print: defaultPrint
    });

    const countContract = defineContract({
        domain, action: actionNames.count,
        description: `Get the number of ${plural} by query.`,
        inputSchema: z.object({ search: CrudParamsSchema.shape.search, searchFields: CrudParamsSchema.shape.searchFields, query: CrudParamsSchema.shape.query }),
        outputSchema: z.number(),
        rest: { method: 'GET', path: `/${plural}/count` },
        destructive: destructive.count, event: eventNames.count,
        isCrud: true,
        print: defaultPrint
    });

    const getContract = defineContract({
        domain, action: actionNames.get,
        description: `Get a specific ${domain} by ID.`,
        inputSchema: GetInputSchema,
        outputSchema,
        rest: { method: 'GET', path: `/${plural}/:${idField}` },
        destructive: destructive.get, event: eventNames.get,
        isCrud: true,
        print: defaultPrint
    });

    const resolveContract = defineContract({
        domain, action: actionNames.resolve,
        description: `Resolve one or more ${plural} by ID(s).`,
        inputSchema: ResolveInputSchema,
        outputSchema: ResolveOutputSchema,
        rest: { method: 'POST', path: `/${plural}/resolve` },
        destructive: destructive.resolve, event: eventNames.resolve,
        isCrud: true,
        print: defaultPrint
    });

    const createContract = defineContract({
        domain, action: actionNames.create,
        description: `Create a new ${domain}.`,
        inputSchema: CreateInputSchema,
        outputSchema,
        rest: { method: 'POST', path: `/${plural}` },
        destructive: destructive.create, event: eventNames.create || true,
        isCrud: true,
        print: defaultPrint
    });

    const createManyContract = defineContract({
        domain, action: actionNames.createMany,
        description: `Create multiple ${plural}.`,
        inputSchema: z.array(CreateInputSchema),
        outputSchema: z.array(outputSchema),
        rest: { method: 'POST', path: `/${plural}/create-many` },
        destructive: destructive.createMany, event: eventNames.createMany || true,
        isCrud: true,
        print: defaultPrint
    });

    const updateContract = defineContract({
        domain, action: actionNames.update,
        description: `Update an existing ${domain}. Only specified fields will be updated.`,
        inputSchema: UpdateInputSchema,
        outputSchema,
        rest: { method: 'PATCH', path: `/${plural}/:${idField}` },
        destructive: destructive.update, event: eventNames.update || true,
        isCrud: true,
        print: defaultPrint
    });

    const replaceContract = defineContract({
        domain, action: actionNames.replace,
        description: `Replace an existing ${domain}. Entire entity will be replaced.`,
        inputSchema: ReplaceInputSchema,
        outputSchema,
        rest: { method: 'PUT', path: `/${plural}/:${idField}` },
        destructive: destructive.replace, event: eventNames.replace || true,
        isCrud: true,
        print: defaultPrint
    });

    const deleteContract = defineContract({
        domain, action: actionNames.delete,
        description: `Delete a specific ${domain} by ID.`,
        inputSchema: IdInputSchema,
        outputSchema: z.object({ success: z.boolean() }),
        rest: { method: 'DELETE', path: `/${plural}/:${idField}` },
        destructive: destructive.delete, event: eventNames.delete || true,
        isCrud: true,
        print: defaultPrint
    });

    const crudResult = {
        domain, idField, baseSchema, outputSchema, relations,
        find: findContract,
        findOne: findOneContract,
        count: countContract,
        get: getContract,
        resolve: resolveContract,
        create: createContract,
        createMany: createManyContract,
        update: updateContract,
        replace: replaceContract,
        delete: deleteContract
    };

    return crudResult as unknown as CrudContracts<
        TBase,
        TIdField,
        TOut,
        z.ZodType<CreateIn<z.output<TBase>, TIdField>, z.ZodTypeDef, CreateIn<z.input<TBase>, TIdField>>,
        z.ZodType<UpdateIn<z.output<TBase>, TIdField>, z.ZodTypeDef, UpdateIn<z.input<TBase>, TIdField>>,
        z.ZodType<ReplaceIn<z.output<TBase>, TIdField>, z.ZodTypeDef, ReplaceIn<z.input<TBase>, TIdField>>,
        z.ZodType<Prettify<IdOnlyIn<TIdField> & z.input<typeof CrudParamsSchema>>, z.ZodTypeDef, Prettify<IdOnlyIn<TIdField> & z.input<typeof CrudParamsSchema>>>,
        typeof CrudParamsSchema,
        typeof CrudParamsSchema,
        z.ZodType<Prettify<{ [K in TIdField]: string | string[] } & z.input<typeof CrudParamsSchema> & { mapping?: boolean, throwIfNotExist?: boolean, reorderResult?: boolean }>, z.ZodTypeDef, Prettify<{ [K in TIdField]: string | string[] } & z.input<typeof CrudParamsSchema> & { mapping?: boolean, throwIfNotExist?: boolean, reorderResult?: boolean }>>,
        z.ZodType<IdOnlyIn<TIdField>, z.ZodTypeDef, IdOnlyIn<TIdField>>
    >;
}
