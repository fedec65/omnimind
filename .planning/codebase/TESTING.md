# Testing Patterns

**Analysis Date:** 2026-06-18

## Test Framework

**Runner:**
- Vitest `^1.6.0` (per `package.json` devDependencies)
- Config: `/Users/federicocesconi/Dev/omnimind/vitest.config.ts`
- `globals: true` — `describe` / `it` / `expect` / `beforeEach` / `afterEach` / `beforeAll` / `afterAll` are global, no need to import them. Tests still do `import { describe, it, expect, beforeEach, afterEach } from 'vitest'` for explicitness.
- `environment: 'node'`
- `testTimeout: 30000` (30s) — overridden per-suite for slow cases (e.g. `EmbeddingEngine` uses `120000` for model download).

**Run Commands:**
```bash
npm test                # vitest run (single shot, CI mode)
npm run test:watch      # vitest (interactive watch)
npm run test:coverage   # vitest run --coverage
npm run benchmark       # tsx tests/benchmarks/RecallBenchmark.ts (separate script)
```

## Test File Organization

**Location:**
- Tests live in `/Users/federicocesconi/Dev/omnimind/tests/` mirroring the source directory tree, NOT co-located with source.
- Mapping: `tests/core/MemoryStore.test.ts` → `src/core/MemoryStore.ts`.

**Structure:**
```
tests/
├── core/                        # Mirrors src/core/
│   ├── CryptoEngine.test.ts
│   ├── EmbeddingEngine.test.ts
│   ├── GraphStore.test.ts
│   ├── MemoryStore.namespace.test.ts   # Variant — extra dot-suffix
│   ├── MemoryStore.test.ts
│   ├── MemoryStore.turns.test.ts       # Variant — extra dot-suffix
│   ├── RelationExtractor.test.ts
│   └── SearchEngine.test.ts
├── layers/                      # Mirrors src/layers/
│   └── AgingPipeline.test.ts
├── prediction/                  # Mirrors src/prediction/
│   ├── ActivityTracker.test.ts
│   ├── ContextInjector.test.ts
│   ├── IntentPredictor.test.ts
│   └── PatternStore.test.ts
├── bus/                         # Mirrors src/bus/
│   ├── ConflictResolver.test.ts
│   ├── MemoryBus.test.ts
│   └── adapters/
│       ├── ChatGPTAdapter.test.ts
│       ├── ClaudeAdapter.test.ts
│       ├── ClaudeDesktopAdapter.test.ts
│       └── CursorAdapter.test.ts
├── integration/                 # End-to-end tests through Omnimind API
│   ├── EndToEnd.test.ts
│   ├── GraphAging.test.ts
│   └── ImportExport.test.ts
└── server/                      # Spins up dist/server.js as a child process
    └── Server.test.ts
```

**Naming:**
- Default: `<ClassName>.test.ts`.
- Variants / split files for a single source: `<ClassName>.<aspect>.test.ts` (e.g. `MemoryStore.namespace.test.ts` isolates namespace behavior from CRUD behavior).

## Test Structure

**Suite Organization:**
Standard pattern — one outer `describe('<ClassName>', ...)` with nested `describe` blocks grouping related cases, plus `beforeEach`/`afterEach` lifecycle hooks for setup/teardown.

```ts
// tests/core/MemoryStore.test.ts
describe('MemoryStore', () => {
  let store: MemoryStore;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omnimind-test-'));
    store = new MemoryStore({ dbPath: join(tmpDir, 'test.db') });
    const result = await store.init();
    expect(result.ok).toBe(true);
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('store', () => { ... });
  describe('get', () => { ... });
  describe('search', () => { ... });
});
```

**Patterns:**
- All test files start with a JSDoc comment block summarizing scope (see `tests/core/MemoryStore.test.ts:1-6`, `tests/integration/EndToEnd.test.ts:1-5`).
- Nested `describe` per method or capability; flat `it('should ...', ...)` per behavior.
- Naming: `it('should <expected behavior>', ...)` — consistent imperative-mood across all suites.
- Tear down every allocated resource (file handles, db connections, temp dirs, file watchers, child processes) in `afterEach` / `afterAll`.

## Mocking

**Framework:** Vitest globals; `vi.mock`, `vi.fn`, `vi.spyOn` available. Used sparingly.

**Patterns:**
- **Hand-rolled test doubles over `vi.mock()`** — adapters and helpers are stubbed by implementing the interface inline. Example from `tests/bus/MemoryBus.test.ts:14-41`:
  ```ts
  class TestAdapter implements ToolAdapter {
    readonly id: string;
    readonly name: string;
    readonly capabilities = ['read', 'write', 'sync', 'notify'] as const;
    receivedEvents: MemoryEvent[] = [];
    connected = false;

    constructor(id: string) { this.id = id; this.name = id; }

    async onConnect(): Promise<void> { this.connected = true; }
    async onDisconnect(): Promise<void> { this.connected = false; }
    async onMemoryEvent(event: MemoryEvent): Promise<void> {
      this.receivedEvents.push(event);
    }
    async publishEvent(_event: MemoryEvent): Promise<void> { /* handled by base in real adapter */ }
  }
  ```
- **Embedding engine mock** (`tests/core/SearchEngine.test.ts:74-76`) — pass a duck-typed object with `embed: async (text) => ({ ok: true, value: createMockEmbedding(384, text.length) })` cast `as unknown as EmbeddingEngine`. Avoids the cost of loading the real transformer model.
- **Deterministic mock embeddings** — `createMockEmbedding(dim, seed)` uses `Math.sin(seed + i * 0.5) + 1` to produce a deterministic, normalized 384-dim vector.
- **File system mocks are avoided** — adapter tests use real `mkdtempSync` + `mkdirSync` + `writeFileSync` against a tmp dir, then `rmSync` in teardown.
- **Private member access for assertions** — `expect(adapter['connected']).toBe(true)` (bracket access). Used in `ClaudeAdapter.test.ts:35, 44, 92`, `ClaudeDesktopAdapter.test.ts:35`.

**What to Mock:**
- External IO that is expensive or non-deterministic: embedding model loading (`EmbeddingEngine`), network.
- Adapters under test of other adapters — pass a minimal `ToolAdapter` test double.

**What NOT to Mock:**
- SQLite — every test uses a real `better-sqlite3` instance against `mkdtempSync(join(tmpdir(), 'omnimind-...-test-'))`. Avoids the need to mock DB behavior and verifies real SQL.
- File system for adapters — tests write real files to tmp dirs.
- HTTP server in `tests/server/Server.test.ts` — spawns the actual `dist/server.js` as a child process via `child_process.spawn`.

## Fixtures and Factories

**Test Data:**
Factories live inside each test file (no shared fixtures directory). Naming: `makeX` / `createX` / `createMockX`.

Examples:
- `tests/core/RelationExtractor.test.ts:12` — `makeEntity(name, type)` factory.
- `tests/layers/AgingPipeline.test.ts:12-35` — `createMemory(overrides: Partial<Memory> = {})` factory using spread-merge defaults.
- `tests/prediction/IntentPredictor.test.ts:12-33` — `makeMemory(id)` factory.
- `tests/prediction/ContextInjector.test.ts:14-36` — `makeMemory(id, content, wing, room)` factory.
- `tests/core/SearchEngine.test.ts:17-32` — `createMockEmbedding(dim, seed)` factory.
- `tests/core/SearchEngine.test.ts:34-67` — `insertMemory(db, memory)` helper for direct row inserts bypassing the store API.
- `tests/prediction/ActivityTracker.test.ts:17-23` — `createTestStore()` async factory.

**Location:**
- Co-located at the top of each test file, above the first `describe`.

**Temp dirs:**
- Created via `mkdtempSync(join(tmpdir(), 'omnimind-<area>-test-'))` in `beforeEach`.
- Cleaned via `rmSync(tmpDir, { recursive: true, force: true })` in `afterEach`.
- Prefix convention: `omnimind-<feature>-test-` (e.g. `omnimind-bus-test-`, `omnimind-graph-aging-`, `omnimind-claude-desktop-test-`).

## Coverage

**Provider:** `@vitest/coverage-v8`.

**Reporter:** `['text', 'json', 'html']` (configured in `vitest.config.ts`).

**Exclude list (configured):**
```ts
exclude: [
  'src/cli.ts',          // CLI entry, exercised manually
  'src/mcp-server.ts',   // MCP entry, exercised manually
  'src/mcp/server.ts',   // MCP server, exercised manually
  'dist/**',
  'tests/**',
  '**/*.test.ts',
  '**/*.config.ts',
]
```

**Thresholds:**
```ts
thresholds: {
  lines: 80,
  functions: 80,
  branches: 70,
  statements: 80,
}
```
Coverage gates fail the build if lines/functions/statements fall below 80% or branches below 70%.

**Output location:** `/Users/federicocesconi/Dev/omnimind/coverage/` (transient `.tmp/` working dir observed; reports written here by default).

**View coverage:**
```bash
npm run test:coverage
# open coverage/index.html in a browser
```

## Test Types

**Unit Tests** (`tests/core/`, `tests/layers/`, `tests/prediction/`, `tests/bus/`):
- Single class/module under test.
- Real SQLite via temp dirs; mocked embeddings; in-process execution.
- Fast (sub-second per file).

**Integration Tests** (`tests/integration/`):
- Full `Omnimind.create({ dataDir, adapters: false })` composition.
- Exercise cross-module flows: store → search → predict, storeTurns → search by sourceId, import/export round-trip, L2 aging → graph persistence.
- Always pass `adapters: false` to skip Claude/Cursor/ChatGPT adapter startup.
- Slower than unit tests (model init + DB init each suite).

**Adapter Tests** (`tests/bus/adapters/`):
- Real adapter under test, real `MemoryStore` + `MemoryBus` underneath.
- Tmp directory used for the conversation-file watch path.
- Often need debounce waits (`await new Promise((r) => setTimeout(r, 2500))`) — adapters debounce fs events 1–3s.

**HTTP Server Tests** (`tests/server/Server.test.ts`):
- Spins up the compiled `dist/server.js` via `child_process.spawn` with `OMNIMIND_PORT=0` and `OMNIMIND_SKIP_ADAPTERS=1`.
- Captures the bound port by parsing `Listening on http://localhost:(\d+)` from `stdout`.
- Hits endpoints with `fetch()` against `http://localhost:${port}`.
- `beforeAll` timeout: 60s (server start + warmup); individual tests: 30s default.
- `afterAll` kills the child process.

**Benchmarks** (separate, NOT executed by `npm test`):
- `/Users/federicocesconi/Dev/omnimind/benchmarks/` contains `longmemeval.ts`, `prediction-accuracy.ts`, `debug-search.ts`, etc.
- Run individually via `tsx benchmarks/<file>.ts`.

## Common Patterns

**Async Testing:**
- Tests are `async () => { ... }`; assertions await directly (no `done` callbacks).
- Async setup in `beforeEach(async () => { ... })`.
- For debounced / timer-driven assertions (adapters), use `await new Promise((r) => setTimeout(r, ms))` to yield (e.g. `ClaudeAdapter.test.ts` waits 2500ms after file writes).

**Error Testing:**
- Pattern: `expect(result.ok).toBe(false)` after intentionally failing operation (see `CryptoEngine.test.ts:52` for tampered auth tag, `CryptoEngine.test.ts:62` for wrong salt).
- Pattern: `await expect(...).resolves.not.toThrow()` for handlers that should swallow errors (e.g. `ClaudeAdapter.test.ts:110`).
- Result-pattern narrowing:
  ```ts
  const result = await store.store('x', { wing: 't' });
  expect(result.ok).toBe(true);
  if (!result.ok) return;          // early-return; narrows `result.value`
  expect(result.value.content).toBe('x');
  ```

**Result unwrapping:**
- Universal idiom in this codebase is the guard + early-return:
  ```ts
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  // r.value is now narrowed correctly
  ```
- Often combined into a single boolean assertion (e.g. `expect(r1.ok && r2.ok).toBe(true); if (!r1.ok || !r2.ok) return;`).

**Suite-wide shared state:**
- For stateless modules (e.g. `ConflictResolver`, `AgingPipeline`), instantiate once outside `describe`:
  ```ts
  describe('AgingPipeline', () => {
    const pipeline = new AgingPipeline();   // shared instance, no beforeEach
  ```
- For stateful modules (MemoryStore, MemoryBus), instantiate per-test in `beforeEach` to avoid leakage.

## Test Configuration Reference

`/Users/federicocesconi/Dev/omnimind/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['src/cli.ts', 'src/mcp-server.ts', 'src/mcp/server.ts',
                'dist/**', 'tests/**', '**/*.test.ts', '**/*.config.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
    testTimeout: 30000,
    benchmark: {
      include: ['tests/benchmarks/**/*.ts'],
    },
  },
});
```

Notes:
- `tests/benchmarks/` directory is referenced for Vitest benchmark but the actual benchmark scripts live in `benchmarks/` (project root) and run via `tsx` directly.
- No `setupFiles` / `globalSetup` configured.
- No path aliases — tests use relative `../../src/...` imports.

## CI Integration

- No dedicated test workflow file under `.github/workflows/` (only `build-native.yml` exists for Tauri native builds).
- Tests run locally via `npm test` / `npm run test:coverage`; release build runs `npm ci && npm run build` (no automated test step on tag push — see `build-native.yml`).

---

*Testing analysis: 2026-06-18*
