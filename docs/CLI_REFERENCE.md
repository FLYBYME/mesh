# CLI Reference

## Overview

Mesh provides a powerful, dynamically-generated Command Line Interface. Instead of hardcoding CLI commands for every tool, the Mesh CLI reads your strictly-typed `ToolContract` definitions and auto-generates Commander.js subcommands with full argument parsing, validation, and help text.

The CLI is invoked via `npx mesh` or `mesh`.

---

## Global Options

The root CLI program accepts options that apply to all subcommands:

| Option | Shorthand | Description | Default |
|---|---|---|---|
| `--node-id <id>` | `-i` | Explicit node identifier | `cli-<random>` |
| `--bootstrap <urls>` | `-b` | Comma-separated list of bootstrap WebSocket URLs | `ws://127.0.0.1:5005` |
| `--port <number>` | `-p` | Port for the WebSocket server | `0` (random) |

*Note on Port*: If you specify `--port 0` (or omit it and run a tool command), the CLI will pick a random ephemeral port to avoid conflicts. If you run `mesh start --port 5005`, it will bind to exactly `5005`.

---

## Built-in Commands

### `mesh start`

Starts a long-running Mesh node.

```bash
npx mesh start --port 5005 --bootstrap ws://127.0.0.1:5005 --services src/
```

**Options**:
- `--services <paths...>` or `-s`: Directories containing service modules (e.g. `src/`, `../mesh-sandbox/src`). The startup sequence recursively scans these directories for `*.service.ts` or `*.service.js` files, instantiates the default export, and registers it.
- `--log-level <level>` or `-l`: `debug`, `info`, `warn`, `error` (default: `info`)

**Multi-Service Loading**:
The `--services` flag accepts multiple paths, either comma-separated or by providing the flag multiple times.

```bash
npx mesh start -s src/ -s ../mesh-sandbox/src
```

### `mesh generate`

Scans all `*.contract.ts` files in your codebase and generates the type-safe CLI and RPC bindings.

```bash
npx mesh generate --contracts "src/**/*.contract.ts" --out "src/generated"
```

**Options**:
- `--contracts <glob>`: Glob pattern to find contract files.
- `--out <dir>`: Output directory for generated files.

**Output Artifacts**:
1. `api.ts`: Augments `IServiceToolRegistry` for type-safe `broker.call()`.
2. `events.ts`: Augments `EventRegistry` for type-safe `broker.on()`.
3. `cli/ToolCommands.ts`: Auto-generated Commander.js subcommands.

---

## Auto-Generated Tool Commands

Every tool defined via `defineContract` (or `defineCrud`) becomes a CLI command. The CLI structure maps directly to the `domain.action` format.

**Format**:
```bash
npx mesh <domain> <action> [options]
```

### Argument Parsing

The CLI generator maps Zod schema fields to Commander options:
- `z.string()` → `--name <string>`
- `z.number()` → `--age <number>`
- `z.boolean()` → `--active` (flag)
- `z.array(z.string())` → `--tags <string...>`

### Dot-Notation for Nested Objects

If a contract has a nested `z.object()` or a `z.record()`, the CLI supports dot-notation to populate those fields without needing to write JSON strings:

```bash
npx mesh email find_one --query.status pending --query.domain example.com
```

This is intercepted by `preprocessArgs` in `src/cli/index.ts` and rewritten to:

```bash
npx mesh email find_one --query '{"status":"pending","domain":"example.com"}'
```

### Example: CRUD Commands

If you define a sandbox CRUD using `defineCrud('sandbox', SandboxSchema)`, you get:

```bash
# Create
npx mesh sandbox create --name "My Sandbox" --image "node:18"

# Get by ID
npx mesh sandbox get --id 64a...

# Find (Search)
npx mesh sandbox find --limit 10 --sort -createdAt --query.status active

# Delete
npx mesh sandbox delete --id 64a...
```

### Output Formatting

When a tool completes, the CLI prints the result. By default, it prints raw JSON. However, if the `ToolContract` provides a custom `print(output)` function, the CLI will use it.

```typescript
export const helloContract = defineContract({
    // ...
    outputSchema: z.object({ message: z.string() }),
    print: (out) => `\n🎉 ${out.message}\n`
});
```

```bash
$ npx mesh demo hello --name World

🎉 Hello World
```

---

## Under the Hood: Tool Execution

When you run a generated tool command (e.g., `npx mesh sandbox get --id 123`):

1. **Boot**: The CLI instantiates a temporary `MeshApp` and loads the Registry, Network, and Broker modules.
2. **Network**: It connects to the cluster using the `--bootstrap` URL.
3. **Discovery**: It calls `registry.waitForTool('sandbox.get', 5000)` to wait until it discovers a peer offering the requested tool.
4. **RPC**: It executes `broker.call('sandbox.get', { id: '123' })`.
5. **Print**: It passes the result to the contract's `print` function.
6. **Teardown**: It stops the `MeshApp` and exits.

Because of this architecture, the CLI node acts as a temporary peer in the network. It does not need a local database connection — it discovers the active backend service and routes the RPC request over WebSockets.

---

## Known defect: a description with an apostrophe emits a file that does not parse

**Found 2026-09-06** by writing a contract in mesh-serve whose description read
`'Resolve a site\'s parts, generate its page, and record what it now serves.'`. The generated
`src/generated/cli/ToolCommands.ts` failed to compile with 80 syntax errors, none of them anywhere
near the contract that caused it.

Two independent bugs compound, in `src/cli/commands/GenerateCommand.ts`:

**The description is read with a regex that stops at the first quote, escaped or not** (line 392):

```js
/\bdescription\s*:\s*['"]([^'"]+)['"]/
```

`[^'"]+` cannot skip `\'`, so the match ends inside the string and the captured description is
`Resolve a site\` — **with a trailing backslash**.

**The captured text is then interpolated into a template literal without escaping** (line 353):

```js
code += `    const cmd_${safeVarName} = ${domain}.command('${m.action}').description(\`${m.description}\`);\n`;
```

The trailing backslash escapes the closing backtick. The template literal never terminates and
swallows everything until the *next* backtick in the file — eleven lines later, in an unrelated
command — so every reported error is in a command that is not the broken one, and the actual cause
appears nowhere in the output.

Either fix alone stops the file being unparseable, and both are worth doing:

- the regex should handle escaped quotes, or the description should be read from the parsed AST
  rather than by matching source text
- **the emitter must escape whatever it interpolates**, since a description may legitimately contain
  a backtick or `${` no matter how the regex improves

Until then, the workaround is to keep apostrophes out of contract descriptions. That is a rule
nobody can be expected to remember, which is why this is written down as a defect rather than a
convention.
