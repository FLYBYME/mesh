# Database Integration

## Overview

The database layer provides automatic MongoDB persistence for any CRUD contract. When a service calls `this.mountCrud(myCrud)`, the framework handles all database operations transparently — the service developer never writes MongoDB queries directly.

The system has three components:

| Component | File | Role |
|---|---|---|
| `Database` | [Database.ts](file:///home/ubuntu/code/mesh/src/db/Database.ts) | MongoDB connection manager, collection accessor |
| `DomainRepository` | [DomainRepository.ts](file:///home/ubuntu/code/mesh/src/db/DomainRepository.ts) | Typed CRUD operations against a single collection |
| `TimeSeriesRepository` | [TimeSeriesRepository.ts](file:///home/ubuntu/code/mesh/src/db/TimeSeriesRepository.ts) | Specialized repository for MongoDB Time Series collections |
| `DatabaseMiddleware` | [DatabaseMiddleware.ts](file:///home/ubuntu/code/mesh/src/db/DatabaseMiddleware.ts) | Broker middleware that intercepts CRUD/TS tools and routes to repositories |

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
`db.repo(schema, domain)` creates or retrieves a `DomainRepository` for a given domain name. The collection name equals the domain name.

`db.tsRepo(schema, domain)` creates or retrieves a `TimeSeriesRepository`. It automatically ensures the collection is created with MongoDB's `timeseries` metadata (using `timestamp` as the time field and `tags` as the meta field).

---

## DomainRepository
...
---

## TimeSeriesRepository

`TimeSeriesRepository<T>` is a specialized repository for time-indexed data. It leverages MongoDB's native Time Series collections for optimized storage and querying.

### Operations

- `insert(points)`: Batch inserts multiple data points. Automatically sets `timestamp` if missing.
- `query(params)`: Retrieves points within a time range (`from`, `to`) and/or matching specific `tags`.
- `latest(tags)`: Returns the single most recent data point for the given tags.
- `aggregate(params)`: Performs time-bucketed aggregation (e.g., `'1m'`, `'1h'`) using `$dateTrunc` and various accumulation functions (`min`, `max`, `avg`, `sum`, `count`).

---

## DatabaseMiddleware
...
1. Check `MeshToolSchemaRegistry` for `isCrud: true` or `isTimeSeries: true` on the tool
2. If not intercepted, call `next()` immediately
3. For CRUD:
    - Look up the domain's Zod output schema
    - Get a `DomainRepository`
    - Execute the database operation
4. For Time Series:
    - Get a `TimeSeriesRepository`
    - Execute `insert`, `query`, `aggregate`, or `latest`
5. Auto-emit lifecycle events for CRUD mutations
6. Return the result

### Action Routing (CRUD)
...
| `delete` | `repo.delete(id)` | `data.deleted` |
| `resolve` | `repo.resolve(params)` | None |

### Action Routing (Time Series)

| Action | Repository Operation |
|---|---|
| `insert` | `repo.insert(points)` |
| `query` | `repo.query(params)` |
| `aggregate` | `repo.aggregate(params)` |
| `latest` | `repo.latest(tags)` |

### ServiceContext Bridge
...
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
