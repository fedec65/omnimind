# Coding Conventions

**Analysis Date:** 2026-06-18

## Naming Patterns

**Files:**
- PascalCase for classes/engines: `MemoryStore.ts`, `CryptoEngine.ts`, `SearchEngine.ts`, `EmbeddingEngine.ts`, `MemoryBus.ts`, `ConflictResolver.ts`, `IntentPredictor.ts`, `PatternStore.ts`, `AgingPipeline.ts`, `ActivityTracker.ts`, `ContextInjector.ts`, `OmnimindMcpServer.ts`
- camelCase for runtime entry points: `index.ts`, `server.ts`, `cli.ts`, `mcp-server.ts`
- Test files mirror source file name + `.test.ts`: `MemoryStore.test.ts`, `CryptoEngine.test.ts`
- Variant test files use dot-naming: `MemoryStore.namespace.test.ts`, `MemoryStore.turns.test.ts`

**Functions:**
- camelCase verbs: `store`, `get`, `delete`, `update`, `search`, `pin`, `unpin`, `init`, `close`, `evictStaleMemories`, `fuseResults`, `applyTemporalBoost`, `buildFilter`, `rowToMemory`, `extractRelations`, `upsertEntity`, `insertRelation`, `recordAccess`
- Factory functions: `createMemoryEvent`, `createMemory`, `buildFingerprint`, `makeMemory`, `makeEntity`, `createTestStore`, `createMockEmbedding`, `tempDb`
- Private helpers prefixed or lower visibility: `prepareStatements`, `rowToMemory`, `buildFilter`, `fuseResults`, `applyTemporalBoost`, `logActivity`, `detectConflict`, `applyResolution`, `persistEvent`, `route`, `matchesFilter`, `addDeadLetter`, `getMachineFingerprint`

**Variables:**
- camelCase, often descriptive multi-word: `eventsPublished`, `eventsRouted`, `conflictsDetected`, `retrievalLatencies`, `processedHashes`, `currentIds`, `uniqueTurns`, `seenHashes`
- Const SQL strings: SCREAMING_SNAKE_CASE for top-level SQL constants (`INIT_SQL`, `FTS_SQL`)

**Types:**
- PascalCase: `Memory`, `MemoryMeta`, `MemoryStoreConfig`, `MemoryLayer`, `SearchResult`, `SearchOptions`, `SearchEngineConfig`, `EmbeddingEngineConfig`, `CryptoEngineConfig`, `IntentPredictorConfig`, `InjectorConfig`, `ActivityTrackerConfig`, `AdapterConfig`, `OmnimindConfig`, `ClaudeAdapterConfig`, `CursorAdapterConfig`, `ChatGPTAdapterConfig`, `ClaudeDesktopAdapterConfig`, `ContextFingerprint`, `PredictedMemory`, `Prediction`, `WisdomPattern`, `ArchivedMemory`, `StoreStats`, `BusStats`, `ConflictResolution`, `DeadLetterEvent`, `MemoryEvent`, `BusSubscription`, `AdapterCapability`, `Entity`, `Relation`, `GraphResult`, `MemoryLayerId`, `EntityType`, `EventType`, `EventPriority`
- Config types use suffix `Config`: `MemoryStoreConfig`, `OmnimindConfig`, `AdapterConfig`
- Options types use suffix `Options`: `SearchOptions`
- Meta types use suffix `Meta`: `MemoryMeta`
- Constants objects are PascalCase (used as enums): `MemoryLayer`, `EventType`, `EventPriority`, `TimeConstants`, `AgingThresholds`, `DefaultSearchConfig`, `PriorityOrder`, `ToolPriority`
- Each constant object has a paired `type X = (typeof X)[keyof typeof X]` alias: `MemoryLayerId`, `EventType`, `EventPriority`
- Source DB row types use internal `Raw...Row` suffix: `RawMemoryRow`, `PatternRow`

## Code Style

**Formatting:**
- Tool: Prettier (`"format": "prettier --write \"src/**/*.ts\" \"tests/**/*.ts\"`)
- No `.prettierrc` committed; uses Prettier defaults (2-space indent, double quotes, trailing commas, semicolons)
- 2-space indentation observed throughout
- Single quotes for strings; template literals for interpolation
- Trailing commas in multi-line literals

**Linting:**
- Config: `.eslintrc.cjs` — `root: true`, extends `eslint:recommended` + `plugin:@typescript-eslint/recommended`
- Key rules:
  - `@typescript-eslint/no-explicit-any` → `warn` (allowed but discouraged)
  - `@typescript-eslint/no-unused-vars` → `error` with `argsIgnorePattern: '^_'` and `varsIgnorePattern: '^_'` (underscore-prefixed allowed)
  - `no-console` → `off` (console logging is intentional)
- Ignore patterns: `dist/`, `node_modules/`, `gui/dist/`, `src-tauri/target/`

**TypeScript Strictness (`tsconfig.json`):**
- `strict: true`
- `noUnusedLocals: true`
- `noUnusedParameters: true`
- `noImplicitReturns: true`
- `noFallthroughCasesInSwitch: true`
- `exactOptionalPropertyTypes: true`
- `noUncheckedIndexedAccess: true` (forces `arr[i]!` non-null assertions or guards)
- `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`
- `isolatedModules: true`
- `tsc` runs as `npm run typecheck` and `npm run build`
- ESM-only (`"type": "module"` in `package.json`) — all local imports use `.js` extension (TS source files import each other via `.js`, e.g. `import { MemoryStore } from './core/MemoryStore.js'`)

## Import Organization

**Order (observed in `src/core/MemoryStore.ts` and `src/index.ts`):**
1. External runtime imports (e.g. `Database from 'better-sqlite3'`, `randomUUID from 'crypto'`, `homedir from 'os'`, `createServer from 'http'`, `Server from '@modelcontextprotocol/sdk/...`).
2. Third-party packages (`zod`, `zod-to-json-schema`, `@xenova/transformers`).
3. Internal sibling modules (relative paths with `.js` extension).
4. Type-only imports use `import { type X }` inline syntax (e.g. `import { type Memory, type MemoryMeta, ok, err } from './types.js'`).

**Path Aliases:**
- None. Use relative paths (`./types.js`, `../core/MemoryStore.js`).
- Tests use relative paths back to source: `../../src/core/MemoryStore.js`, `../../../src/bus/adapters/ClaudeAdapter.js`.

**Rules:**
- Always include the `.js` extension on relative imports (required for NodeNext ESM resolution).
- Type-only imports use `import type { ... }` when fully type-only, or `import { type X, Y }` when mixed.

## Error Handling

**Primary pattern: `Result<T, E = Error>` (typed Result, not exceptions).**

Defined in `src/core/types.ts:167-180`:
```ts
export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> { ... }
export function err<E>(error: E): Result<never, E> { ... }
```

**Conventions:**
- Every fallible operation in the core layers (`MemoryStore`, `EmbeddingEngine`, `CryptoEngine`, `IntentPredictor`, `PatternStore`, `ContextInjector`, `ActivityTracker`, `AgingPipeline`, `MemoryBus`, `ConflictResolver`, `Adapters`) returns `Promise<Result<T>>` or `Result<T>`.
- Check with `if (!result.ok) return err(result.error);` — early-return the propagated error.
- Access value with `result.value` (TS narrowing makes this safe after the `ok` guard).
- Wrapping unknown thrown errors: `return err(error instanceof Error ? error : new Error(String(error)));` — used everywhere as the catch-block convention.
- Init guards: methods on classes with explicit init lifecycle check `if (!this.initialized) return err(new Error('Store not initialized'));` (see `MemoryStore.store`, `MemoryStore.get`, `MemoryStore.delete`, `EmbeddingEngine.embed`).

**Where exceptions are used (boundary layers):**
- `src/index.ts` (`Omnimind.create`): throws `new Error(...)` on init failure — this is the public factory.
- `src/mcp/server.ts`: MCP tool handlers throw caught errors to return `isError: true` responses; tool dispatcher re-throws via `throw result.error;`.
- `src/mcp-server.ts`: top-level entry catches and `console.error`'s.
- `src/server.ts`: HTTP request handler wraps with `.catch(err => ...)` to return 500 JSON.

**Silenced errors (intentional non-critical):**
- Vector index operations in `MemoryStore` and `SearchEngine` wrap VSS calls in `try { ... } catch {}` with a comment `// VSS insert failed — non-critical` (see `SearchEngine.indexVector`, `indexVectorsBatch`, `deleteVector`, `MemoryStore.restoreFromArchive`).
- `MemoryBus.unregisterAdapter` calls `adapter.onDisconnect().catch(() => {})` and `route()` calls `adapter.onMemoryEvent(event).catch(...)` — failures are pushed to the dead-letter queue instead of throwing.
- `MemoryStore.logActivity` has `try { ... } catch { // Non-critical — don't fail on logging errors }`.
- ActivityTracker file-watcher failures are caught locally.

## Logging

**Framework:** `console` only (no logging library). `no-console` is explicitly off.

**Patterns:**
- Bracketed component prefix: `[MemoryStore]`, `[SearchEngine]`, `[MemoryBus]`, `[Omnimind]`, `[Omnimind MCP]`, `[Omnimind Server]`, `[ClaudeAdapter]`, `[EmbeddingEngine]`, `[IntentPredictor]`, `[ActivityTracker]`, `[Server]`, `[Static]`.
- Levels by severity:
  - `console.error` — fatal init failures, unhandled exceptions, adapter registration errors.
  - `console.warn` — degraded operation (VSS unavailable, slow queries, failed upserts).
  - `console.log` — informational (connections, lifecycle events, status messages).
- Slow-operation warnings measure with `performance.now()` and emit at thresholds:
  - `MemoryStore.search` warns if `latency > 50ms`.
  - `MemoryBus.publish` logs if `latency > 10ms`.
  - `IntentPredictor.predict` warns if `latency > 5ms`.
- MCP/HTTP entry points use `console.error` (stdout reserved for protocol messages / HTTP responses).

## Comments

**When to Comment:**
- Every public module begins with a JSDoc block summarizing purpose and key design decisions (see `src/core/MemoryStore.ts:1-9`, `src/core/CryptoEngine.ts:1-9`, `src/bus/MemoryBus.ts:1-11`, `src/prediction/IntentPredictor.ts:1-12`).
- Class-level JSDoc includes a `Usage:` block with example code (see `MemoryStore`, `CryptoEngine`, `SearchEngine`, `IntentPredictor`).
- Methods have brief JSDoc when behavior is non-obvious; simple getters/setters are not commented.
- Inline comments mark non-obvious branches: `// ─── Section ────` style dividers separate logical groups of methods (see `MemoryStore` sections: `// ─── CRUD ───`, `// ─── Search ───`, `// ─── Memory Eviction / Archive ───`, `// ─── Private helpers ───`).

**JSDoc/TSDoc:**
- `@param`, `@returns` used sparingly; mainly in `src/core/RelationExtractor.ts:42-46`.
- Tag-style documentation is present but minimal — most docs are free-form prose.

## Function Design

**Size:** No enforced limit. Largest source files: `src/core/MemoryStore.ts` (1872 lines), `src/index.ts` (744 lines), `src/mcp/server.ts` (649 lines), `src/server.ts` (581 lines), `src/prediction/IntentPredictor.ts` (448 lines). Methods are kept short; large classes are sectioned with `// ─── ───` dividers.

**Parameters:**
- Init / config objects passed as first arg: `new MemoryStore(config: MemoryStoreConfig)`, `new EmbeddingEngine(config: EmbeddingEngineConfig)`, `new AgingPipeline()`, `new IntentPredictor(config: IntentPredictorConfig = {})`.
- Optional options bag as second arg with `= {}` default: `store.search(query, opts: SearchOptions = {})`, `store.listArchive(opts = {})`, `store.queryEntities(opts = {})`, `store.evictStaleMemories(opts = {})`.
- All optional fields use `T | undefined` (not optional `?:`) per `exactOptionalPropertyTypes: true`.

**Return Values:**
- Fallible operations return `Result<T>` or `Promise<Result<T>>`.
- Pure helpers / getters return raw values (`getStats(): BusStats`, `getVectorClock(): Record<string, number>`, `getAdapters(): ToolAdapter[]`, `getDeadLetter(): readonly DeadLetterEvent[]`).
- Read-only arrays exposed via `readonly` modifier and `readonly T[]` return types: `getDeadLetter(): readonly DeadLetterEvent[]`, `getConflicts(): readonly ConflictResolution[]`.
- Time thresholds exposed via the `TimeConstants` object: `TimeConstants.DAY`, `WEEK`, `MONTH`, `HALF_YEAR`, `YEAR` (ms).

## Module Design

**Exports:**
- Each file exports one primary class and its companion `*Config` interface from the same file (e.g. `MemoryStore` + `MemoryStoreConfig`, `CryptoEngine` + `CryptoEngineConfig`).
- All types shared across modules live in `src/core/types.ts` (memory-related) and `src/bus/types.ts` (bus/adapter-related).
- Factories are top-level exports: `createMemoryEvent` from `src/bus/types.ts`, `ok` / `err` from `src/core/types.ts`, `buildFingerprint` / `extractRelations` from their respective modules.
- Public API surface for the whole package is re-exported from `src/index.ts` (`Omnimind` class, all type exports, `MemoryLayer`, `ok`/`err`, `extractRelations`).

**Barrel Files:**
- Not used. Each module exports from its own file. `src/index.ts` re-exports types from `src/core/types.ts` and `src/bus/types.ts` to form the public surface.

**Composition Root:**
- `src/index.ts` is the only composition root — it wires `MemoryStore` → `EmbeddingEngine`, `SearchEngine`, `AgingPipeline`, `IntentPredictor`, `PatternStore`, `MemoryBus`, `ActivityTracker`, `ContextInjector`, and adapters inside `Omnimind.create({ ... })`.
- Composition uses `private constructor` + `static async create(...)` factory pattern (see `Omnimind` class).

## Async & Concurrency Conventions

- All IO-bound methods are `async` and return `Promise<Result<T>>`.
- Synchronous DB lookups (better-sqlite3) return `Result<T>` directly without `Promise`.
- Bulk writes use `db.transaction(items => ...)` wrappers for atomicity (see `MemoryStore.storeTurns`, `evictStaleMemories`, `importMemories`, `PatternStore.save`).
- Embedding batch processing chunks at `batchSize = 8` (see `EmbeddingEngine.embedBatch`).
- Vector index batch updates pre-fetch all rowids, then insert in a single transaction (`SearchEngine.indexVectorsBatch`).

## Svelte / GUI Conventions (`gui/src/`)

- Svelte 5 runes used: `$state(...)` for reactive state (see `gui/src/lib/stores.svelte.ts:3-12`), `$effect(() => ...)` for side effects (`gui/src/App.svelte:22-26`).
- Reactive state modules use `.svelte.ts` extension (not `.ts`) — required by Svelte 5 for rune-aware files.
- Stores export both `appState` (a `$state(...)` proxy) and action functions that mutate it (`setError`, `setTimeout` cleanup in `setError`).
- GUI types are duplicated/mirrored from `src/core/types.ts` in `gui/src/lib/api.ts` (kept loose with `matchType: string`, `type: string` to avoid pulling server types into the bundle).

## Database Schema Conventions

- SQL kept in top-level `const INIT_SQL = \`...\`` template strings within each store class.
- Column names use `snake_case` (`created_at`, `accessed_at`, `content_hash`, `source_tool`); TypeScript field names use `camelCase` (`createdAt`, `accessedAt`, `contentHash`, `sourceTool`); mapping done in `rowToMemory` helpers.
- Migrations handled inline at init time with `ALTER TABLE ... ADD COLUMN` guarded by `pragma('table_info(...)')` checks (see `MemoryStore.init:264-268`).
- Indexes created via `CREATE INDEX IF NOT EXISTS idx_<table>_<col>` pattern.

---

*Convention analysis: 2026-06-18*
