# Database Integration

## Overview

The database layer provides automatic MongoDB persistence for any CRUD contract. When a service calls `this.mountCrud(myCrud)`, the framework handles all database operations transparently — the service developer never writes MongoDB queries directly.

The system has three components:

| Component | File | Role |
|---|---|---|
| `Database` | [Database.ts](file:///home/ubuntu/code/mesh/src/db/Database.ts) | MongoDB connection manager, collection accessor |
| `DomainRepository` | [DomainRepository.ts](file:///home/ubuntu/code/mesh/src/db/DomainRepository.ts) | Typed CRUD operations against a single collection |
| `DatabaseMiddleware` | [DatabaseMiddleware.ts](file:///home/ubuntu/code/mesh/src/db/DatabaseMiddleware.ts) | Broker middleware that intercepts CRUD tools and routes to repositories |

---

## Database Connection

`Database` wraps the MongoDB native driver. It reads the connection URI from `MONGODB_URI` environment variable (or accepts it as a constructor argument) and connects using `MongoClient.connect()`.

```typescript
const db = new Database(logger, 'mongodb+srv://...', 'my-app');
await db.connect();
```

The database name is extracted from the URI path, or falls back to the second constructor argument, or defaults to `'mesh'`.

`db.repo(schema, domain)` creates or retrieves a `DomainRepository` for a given domain name. The collection name equals the domain name.

---

## DomainRepository

`DomainRepository<T>` is a strictly-typed gateway to a MongoDB collection. Every method validates input and output through Zod schemas — there is zero use of `any`.

### ID Mapping

MongoDB uses `_id: ObjectId` internally, but the application layer uses `id: string`. The repository handles this translation transparently:

- **Inbound** (`mapQuery`): Converts `{ id: '...' }` filters to `{ _id: new ObjectId('...') }`. Also handles MongoDB operators like `$in`, `$nin`, `$eq`, `$ne` on ID fields, and recursively maps `$or` / `$and` arrays.
- **Outbound** (`mapOutbound`): Strips `_id`, adds `id: _id.toString()`, and validates the result through the Zod schema.

### Operations

#### `find(options)`

```typescript
const items = await repo.find({
    query: { status: 'active' },
    limit: 10,
    offset: 20,
    sort: '-createdAt',       // Descending by createdAt
    fields: ['name', 'status'],
    search: 'test',
    searchFields: ['name']
});
```

Supports `offset` (skip), `limit`, and flexible sort parsing:
- String: `'-createdAt'` → `{ createdAt: -1 }`
- Array: `['name', '-createdAt']` → `{ name: 1, createdAt: -1 }`
- Object: `{ createdAt: -1 }` → passed directly

#### `findOne(query, options)`

Same as `find` but returns a single document or `undefined`. Supports `sort` and `offset`.

#### `get(id)`

Direct lookup by string ID. Returns `undefined` if the ID is not a valid ObjectId or doesn't exist.

#### `create(data)`

1. Generates a new `ObjectId` (or uses the provided `id` if it's a valid ObjectId string)
2. Sets `createdAt` and `updatedAt` to `new Date()`
3. Validates the complete document through the Zod schema
4. Inserts into MongoDB
5. Returns the validated document with `id` as a string

#### `update(id, data)`

Uses `$set` with `findOneAndUpdate` and `returnDocument: 'after'`. Always sets `updatedAt` to the current time. Returns the updated document.

#### `replace(id, data)`

Uses `findOneAndReplace`. Preserves the original `createdAt` and sets a new `updatedAt`. Returns the replaced document.

#### `delete(id)`

Calls `deleteOne`. Returns `true` if a document was deleted.

#### `count(query)`

Returns the number of documents matching the query.

#### `resolve(params)`

Batch-resolves one or more IDs:
- If given a single string ID: returns one document (throws if not found)
- If given an array of IDs: returns an array of documents via `$in` query

#### `list(options)` (Paginated)

Returns a `ListResult<T>` with: `rows`, `total`, `page`, `pageSize`, `totalPages`. Uses page-based pagination (1-indexed).

---

## DatabaseMiddleware

[DatabaseMiddleware.ts](file:///home/ubuntu/code/mesh/src/db/DatabaseMiddleware.ts) is installed as **local middleware** on the broker during `DatabaseModule.onStart()`:

```typescript
const middleware = createDatabaseMiddleware(broker, this.db);
broker.useLocal(middleware);
```

### Interception Logic

For every `broker.call()`:

1. Check `MeshToolSchemaRegistry` for `isCrud: true` on the tool
2. If not CRUD, call `next()` immediately (pass through to normal handler)
3. Look up the domain's Zod output schema from the `get` or `create` tool registration
4. Get or create a `DomainRepository` for the domain
5. Call `module.beforeCrud(domain, action, params, ctx)` for pre-processing hooks
6. Execute the database operation based on the action name
7. Call `module.afterCrud(domain, action, result, ctx)` for post-processing hooks
8. Auto-emit lifecycle events (`data.created`, `data.updated`, `data.deleted`)
9. Return the result

### Action Routing

| Action | Database Operation | Event Emitted |
|---|---|---|
| `find` | `repo.find(options)` | None |
| `find_one` | `repo.findOne(query, { sort, offset })` | None |
| `count` | `repo.count(query)` | None |
| `get` | `repo.get(id)` | None |
| `create` | `repo.create(params)` | `data.created` |
| `create_many` | `repo.create(item)` for each | `data.created` per item |
| `update` | `repo.update(id, params)` | `data.updated` |
| `replace` | `repo.replace(id, params)` | `data.updated` |
| `delete` | `repo.delete(id)` | `data.deleted` |
| `resolve` | `repo.resolve(params)` | None |

### ServiceContext Bridge

The middleware constructs a `serviceCtx` object for CRUD hooks that provides fully typed `call` and `emit` methods, preventing hook implementations from needing to cast or use `any`:

```typescript
const serviceCtx = {
    broker,
    correlationId: ctx.correlationID,
    nodeID: broker.nodeID,
    call: <K extends keyof IServiceToolRegistry>(a: K, p: ...) => broker.call(a, p),
    emit: <K extends keyof EventRegistry>(e: K, p: ...) => broker.emit(e, p),
    logger: broker.logger
};
```

---

## DatabaseModule

[DatabaseModule.ts](file:///home/ubuntu/code/mesh/src/modules/DatabaseModule.ts) manages the database lifecycle:

| Phase | Action |
|---|---|
| `onInit` | Creates the `Database` instance, registers it as the `database` provider |
| `onStart` | Connects to MongoDB, installs `DatabaseMiddleware` on the broker |
| `onStop` | Disconnects from MongoDB |

### Configuration

```typescript
app.use(new DatabaseModule({
    uri: 'mongodb+srv://user:pass@cluster.mongodb.net/mydb',
    dbName: 'override-name'  // Optional, extracted from URI if omitted
}));
```

If no `uri` is provided, it falls back to `process.env.MONGODB_URI`.
