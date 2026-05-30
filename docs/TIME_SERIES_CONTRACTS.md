# Time Series Contracts

## Overview

Time Series contracts in Mesh provide a first-class abstraction for handling time-indexed data. They are designed for high-throughput ingestion and efficient querying of metrics, telemetry, and event logs. 

When you define a Time Series contract, the Mesh framework automatically:
1.  Generates a set of specialized tools (`insert`, `query`, `aggregate`, `latest`).
2.  Manages an optimized **MongoDB Time Series collection** for that domain.
3.  Handles batching and time-based aggregation logic transparently.

---

## Defining a Time Series Contract

Use the `defineTimeSeries` factory to declare your data model. You only need to provide the "value" schema — the framework automatically adds `timestamp` and `tags` fields.

```typescript
import { z } from 'zod';
import { defineTimeSeries } from 'mesh';

export const telemetryContract = defineTimeSeries('telemetry', z.object({
    cpu: z.number().describe("CPU usage percentage"),
    memory: z.number().describe("Memory usage in MB"),
    load: z.number().optional()
}));
```

### Automatic Schema Enrichment

The resulting `outputSchema` for the contract will be:
- `cpu`: number
- `memory`: number
- `load`: number (optional)
- `timestamp`: Date (the primary time index)
- `tags`: Record<string, string> (metadata for filtering, e.g. `{ host: "web-01" }`)

---

## Generated Tools

A Time Series contract generates 4 standard tools for the domain:

### 1. `domain.insert`
Used for batch ingestion of data points.

- **Input**: An array of objects matching the base schema (plus optional `timestamp` and `tags`).
- **Output**: `{ count: number }`

```typescript
await broker.call('telemetry.insert', [
    { cpu: 12, memory: 512, tags: { host: 'A' } },
    { cpu: 15, memory: 540, tags: { host: 'A' } }
]);
```

### 2. `domain.query`
Retrieves raw data points within a time range.

- **Input**:
    - `from`: Start Date (optional)
    - `to`: End Date (optional)
    - `tags`: Record<string, string> filter (optional)
    - `limit`: Max points (optional)
- **Output**: Array of data points.

### 3. `domain.latest`
Retrieves the single most recent point matching the filter.

- **Input**: `{ tags?: Record<string, string> }`
- **Output**: A single data point or `undefined`.

### 4. `domain.aggregate`
Performs time-bucketed statistics.

- **Input**:
    - `from` / `to` / `tags`: Filtering criteria.
    - `interval`: Bucket size (e.g., `'1m'`, `'1h'`, `'1d'`).
    - `aggregates`: A map of field names to functions (`'min'`, `'max'`, `'avg'`, `'sum'`, `'count'`).
- **Output**: Array of buckets.

```typescript
const stats = await broker.call('telemetry.aggregate', {
    interval: '5m',
    aggregates: {
        cpu: 'avg',
        memory: 'max'
    }
});
```

---

## Implementation Details

### MongoDB Time Series Collections
On the first insertion, Mesh automatically creates a collection with the `timeseries` option enabled in MongoDB:
- `timeField`: `"timestamp"`
- `metaField`: `"tags"`
- `granularity`: `"seconds"` (default)

This ensures that MongoDB uses its specialized columnar-style storage for metrics, significantly reducing disk space and improving query performance for large datasets.

### Middleware Interception
Just like CRUD, Time Series tools are marked with `isTimeSeries: true`. The `DatabaseMiddleware` intercepts these calls and routes them to a `TimeSeriesRepository`. This repository handles the complex MongoDB aggregation pipelines required for time-bucketing (`$dateTrunc`).

---

## Best Practices

1.  **Use Tags for Cardinality**: Put stable metadata (host IDs, region, service name) in `tags`. Avoid putting highly dynamic data in tags as it can affect index performance.
2.  **Batch Your Inserts**: The `insert` tool accepts an array. For high-volume telemetry, buffer points locally and send them in batches of 50-100 to reduce network overhead.
3.  **Use Aggregate for Dashboards**: When building charts, always prefer the `aggregate` tool over `query`. It reduces the amount of data sent over the wire by summarizing points into buckets on the database server.
