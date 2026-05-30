# Writing Unit Tests for Mesh Services

Testing services built on the Mesh engine requires spinning up a localized, fully wired application environment. Because Mesh relies heavily on Dependency Injection (DI), the Service Broker, and a real MongoDB persistence layer, we provide a dedicated `TestHelpers` module to make integration testing seamless and perfectly isolated.

## The Testing Philosophy

1. **Real Persistence:** We test against a real MongoDB instance rather than mocking the database. This ensures your Zod schemas, CRUD interceptors, and database adapters function exactly as they will in production.
2. **Total Isolation:** To prevent parallel tests from colliding, the helpers generate a **unique database name** for every test file (e.g., `mesh_test_a8f9c2`). 
3. **Clean Teardown:** Tests must rigorously clean up after themselves by destroying the app instance and dropping the temporary database.

## Prerequisites

Your test runner (e.g., Jest) needs access to a MongoDB connection string. Ensure you have a `.env` file in your project root, or set the environment variable directly before running tests:

```bash
MONGODB_URI="mongodb://localhost:27017"
```

## The `TestHelpers` API

The core testing utilities are exported from `mesh`.

- `createTestApp(options)`: Boots a complete `MeshApp` instance. It automatically wires up the Registry, Broker, and Database modules, generates a unique test database, and allows you to inject your custom modules. Returns `{ app, dbName }`.
- `destroyTestApp(app)`: Safely stops the mesh node and disconnects the database client.
- `dropTestDatabase(dbName, mongoUri?)`: Connects to MongoDB and drops the specified database.

---

## Example: Writing a Jest Test Suite

Here is a complete example of how to test a custom Mesh service (e.g., `MyService`) using Jest.

```typescript
import { 
    IServiceBroker,
    createTestApp, 
    destroyTestApp, 
    dropTestDatabase 
} from 'mesh';
import { MyService } from '../src/my.service.ts'; // Your service module

describe('MyService Integration Tests', () => {
    let app;
    let broker: IServiceBroker;
    let testDbName: string;

    // 1. Setup Phase
    beforeAll(async () => {
        // createTestApp generates a unique DB and wires up the core modules
        const setup = await createTestApp({
            nodeID: 'test-runner-node',
            modules: [new MyService()] // Inject the service you want to test
        });
        
        app = setup.app;
        testDbName = setup.dbName;
        broker = app.getProvider<IServiceBroker>('broker');
    });

    // 2. Teardown Phase
    afterAll(async () => {
        // Crucial: Stop the app and drop the isolated database
        await destroyTestApp(app);
        await dropTestDatabase(testDbName);
    });

    // 3. Testing Tool Calls
    describe('Tool Execution', () => {
        it('should successfully execute a tool call via the broker', async () => {
            // Use broker.call just like another node would
            const result = await broker.call('my_domain.do_something', { 
                input: 'test data' 
            });
            
            expect(result).toBeDefined();
            expect(result.success).toBe(true);
        });
    });

    // 4. Testing Persistence (CRUD)
    describe('Database Persistence', () => {
        it('should create and retrieve a document', async () => {
            // Test the automated CRUD pipeline
            const created = await broker.call('my_domain.create', { 
                name: 'Test Item', 
                value: 42 
            });
            
            expect(created.id).toBeDefined();

            const fetched = await broker.call('my_domain.get', { 
                id: created.id 
            });
            
            expect(fetched.name).toBe('Test Item');
            expect(fetched.value).toBe(42);
        });
    });
});
```

## Tips for Reliable Tests

1. **Never mock the Broker for integration tests:** `createTestApp` provides a real `ServiceBroker`. Always test your service by making calls through the broker (`broker.call(...)`) rather than calling methods on your service class directly. This ensures all middleware and Zod validations are executed.
2. **Type Safety:** If you want strict typing in your tests (to avoid `as any`), use TypeScript declaration merging to augment the `IServiceToolRegistry` within your test file, just as the code generator does for production code.
3. **Eventual Consistency:** If you are testing against a remote MongoDB cluster (like Atlas), remember that database writes can occasionally experience minor latency. If you perform a `find` or `count` immediately after a `create` loop, consider adding a tiny delay (e.g., 50-100ms) to ensure the data is visible.