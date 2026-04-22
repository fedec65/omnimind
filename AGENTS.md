# Agent Behavior Rules

## Project: Omnimind

This file defines how AI agents should behave when working on this project.

---

## Project Overview

**Omnimind** is a proactive, cross-tool memory system for LLMs. It stores, searches, and predicts relevant context across AI tools (Claude Code, Cursor, ChatGPT, etc.) via the Model Context Protocol (MCP).

Key characteristics:
- **100% local** — Zero external API calls during operation (models are downloaded once).
- **Privacy-first** — All data stays on the user's machine in `~/.omnimind/`.
- **Neuro-symbolic** — Every memory exists as text, vector embedding, and knowledge graph simultaneously.
- **Hierarchical aging** — Memories compress over time: Verbatim → Compressed → Concept → Wisdom.
- **Proactive prediction** — Predicts which memories a user needs before they ask, based on activity patterns.

Version: `0.1.0` | License: MIT | Runtime: Node.js >= 18

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Language | TypeScript 5.5 (strict mode) |
| Runtime | Node.js >= 18 |
| Database | SQLite (`better-sqlite3`) with WAL mode |
| Vector Search | `sqlite-vss` (optional; falls back to brute-force cosine similarity) |
| Keyword Search | FTS5 (Porter stemmer) |
| Embeddings | Local ONNX (`onnxruntime-node`) — all-MiniLM-L6-v2 (384-dim) |
| MCP Protocol | `@modelcontextprotocol/sdk` |
| Validation | `zod` |
| Testing | `vitest` with `@vitest/coverage-v8` |
| Dev Runner | `tsx` |
| Linting | `eslint` (TypeScript parser + plugin) |
| Formatting | `prettier` |

---

## Build and Development Commands

All commands run from the project root:

```bash
# Install dependencies
npm install

# Type-check only (no emit)
npm run typecheck

# Build for production (tsc → dist/)
npm run build

# Development mode with watch
npm run dev

# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run benchmarks (note: benchmark files are referenced but not yet present)
npm run benchmark

# Lint
npm run lint

# Lint and fix
npm run lint:fix

# Format code
npm run format

# Start built application
npm start

# Start MCP server
npm run mcp
```

**Important:** Run `npm test` before committing any changes. Coverage thresholds are enforced:
- Lines: >= 80%
- Functions: >= 80%
- Branches: >= 70%
- Statements: >= 80%

---

## Code Organization

```
src/
├── core/               # Memory engine core
│   ├── MemoryStore.ts  # SQLite CRUD, hybrid search, stats
│   ├── EmbeddingEngine.ts  # Local ONNX embedding generation
│   ├── SearchEngine.ts     # Vector + keyword search, fusion, temporal boost
│   └── types.ts            # All domain types, Result<T,E>, constants
├── layers/             # Hierarchical memory aging
│   └── AgingPipeline.ts    # L0→L1→L2→L3 transitions (rule-based, zero LLM)
├── prediction/         # Proactive memory prediction
│   └── IntentPredictor.ts  # Activity-pattern-based prediction + context fingerprinting
├── mcp/                # MCP server implementation
│   └── server.ts           # OmnimindMcpServer (4 tools: search/store/predict/status)
├── cli.ts              # Command-line interface (omnimind binary)
├── mcp-server.ts       # MCP server entry point (omnimind-mcp binary)
└── index.ts            # Main public API (Omnimind class)

tests/
├── core/               # Unit tests for core modules
│   ├── MemoryStore.test.ts
│   └── EmbeddingEngine.test.ts
└── layers/             # Unit tests for aging pipeline
    └── AgingPipeline.test.ts
```

### Entry Points

- **Library:** `src/index.ts` — exports `Omnimind` class and types.
- **CLI:** `src/cli.ts` — commands: `init`, `store`, `search`, `predict`, `status`, `mine`, `wipe`.
- **MCP Server:** `src/mcp-server.ts` — starts `OmnimindMcpServer` on stdio.

### Key External Interfaces

- `MemoryStore` — internal SQLite-backed store; used by both CLI and MCP server.
- `OmnimindMcpServer` — exposes 4 MCP tools with Zod-validated inputs:
  - `omnimind_search`
  - `omnimind_store`
  - `omnimind_predict`
  - `omnimind_status`

---

## Code Style Guidelines

### TypeScript Conventions

- **Strict mode enabled** — `tsconfig.json` sets `strict: true`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `isolatedModules`.
- **No `any` types** — Use precise types. The `Result<T, E>` pattern is preferred over throwing in core logic.
- **Imports with `.js` extensions** — Required because `moduleResolution` is `NodeNext`.
- **Interface-first design** — All public APIs are typed via interfaces defined in `src/core/types.ts`.
- **Async/await over raw Promises**.
- **Functional transformations preferred** over imperative loops where performance allows.

### Error Handling

Core modules return a `Result<T, E>` type:

```typescript
export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
```

Use `ok(value)` and `err(error)` helpers from `src/core/types.js`. Do not throw in core store/engine logic. CLI and MCP handlers may throw to produce user-facing errors.

### File Naming

- **PascalCase** for classes and modules that export a primary class: `MemoryStore.ts`, `EmbeddingEngine.ts`.
- **camelCase** for functions and utilities: `buildFingerprint`.
- **kebab-case** for config files: `tsconfig.json`, `vitest.config.ts`.

### Comments

- **JSDoc** for all exported functions, classes, and public methods.
- Inline comments only for complex algorithms.
- No commented-out code.

---

## Testing Instructions

### Framework

- **Vitest** with `globals: true` and `environment: 'node'`.
- Test timeout is 30 seconds (`testTimeout: 30000`).
- Coverage provider: `v8`.

### Writing Tests

Follow this structure:

```typescript
import { describe, it, expect } from 'vitest';

describe('ModuleName', () => {
  it('should do X when Y', async () => {
    // Arrange
    // Act
    // Assert
  });
});
```

### Testing Patterns

- **Use temporary directories** for database-backed tests to ensure isolation:
  ```typescript
  import { mkdtempSync, rmSync } from 'fs';
  import { tmpdir } from 'os';
  import { join } from 'path';

  const tmpDir = mkdtempSync(join(tmpdir(), 'omnimind-test-'));
  const store = new MemoryStore({ dbPath: join(tmpDir, 'test.db') });
  // ... after test ...
  rmSync(tmpDir, { recursive: true, force: true });
  ```

- **Guard `Result` access** — Always check `result.ok` before accessing `result.value`:
  ```typescript
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.content).toBe('...');
  ```

- **Skip model-dependent tests gracefully** — `EmbeddingEngine` tests check if the ONNX model exists and skip if not (useful for CI without network).

### Running Tests

```bash
# All tests
npm test

# Single test file
npx vitest run tests/core/MemoryStore.test.ts

# With coverage
npm run test:coverage
```

---

## Security Considerations

### Mandatory Rules

1. **No external API calls in core paths** — The `EmbeddingEngine` downloads the ONNX model and tokenizer vocab from Hugging Face **once** on first initialization. All other operations (storage, search, prediction, compression) must be 100% local and work offline.
2. **User data is encrypted at rest** — The design specifies AES-256-GCM encryption for the SQLite database. Do not implement unencrypted persistence for sensitive memory content.
3. **SQLite queries must be parameterized** — Use prepared statements (see `MemoryStore.prepareStatements()`). Never concatenate user input into SQL strings.
4. **No hardcoded secrets or API keys**.
5. **File paths are validated** before access.

### Privacy Constraints

- Never track file contents (only file extensions and paths for context fingerprinting).
- Never track external URLs.
- Never track system processes.
- Activity logging is limited to: `projectPath` hash, `gitBranch` hash, file extension, tool name, memory access events.

---

## Key Design Decisions

### 1. Result Type Over Exceptions

All core engine methods (`MemoryStore`, `EmbeddingEngine`, `SearchEngine`, `AgingPipeline`) return `Result<T, Error>`. CLI and MCP layers unwrap these and may throw to produce user-facing messages.

### 2. Lazy Aging

Memories are not aged on a schedule. Aging is triggered **on access** (`Omnimind.checkAging`). Pinned memories never age. Old representations are retained as references (e.g., `compressedRef` links back to the original memory ID).

### 3. Hybrid Search

Search combines:
- **Vector similarity** (`sqlite-vss` or brute-force cosine fallback)
- **Keyword search** (FTS5 with Porter stemming)
- **Fusion** — weighted sum (default `alpha = 0.7` for vector, `0.3` for keyword)
- **Temporal boosting** — recent memories get an exponential decay boost (half-life default: 7 days)

### 4. Zero-LLM Write Path

All storage-side transformations use local heuristics:
- **L0 → L1:** Regex-based shorthand compression (symbols, abbreviations, filler removal)
- **L1 → L2:** Regex-based entity extraction + concept summarization
- **L2 → L3:** Pattern extraction ("prefer X over Y", "X should Y")

### 5. Context Injection Budget

Predictions injected into LLM context must stay under **150 tokens**. The `formatPredictions` method truncates content to 200 characters per prediction and limits to 3 predictions.

### 6. Prediction Constraints

- Only predict when confidence >= 70%.
- Max 3 predictions per trigger.
- Target latency: < 5ms.
- Never block user interaction.

---

## Commit Message Format

```
type(scope): description

[optional body]

[optional footer]
```

**Types:** `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `chore`
**Scopes:** `core`, `layers`, `prediction`, `bus`, `gui`, `mcp`, `test`

Examples:
- `feat(core): add temporal query support to MemoryStore`
- `fix(layers): prevent double-compression in AgingPipeline`
- `perf(prediction): reduce predictor latency from 8ms to 3ms`

---

## Documentation Requirements

When making changes, update:
1. `ARCHITECTURE.md` — if the design or data schema changes.
2. `ROADMAP.md` — if phase items are completed or reprioritized.
3. JSDoc comments — for all new or changed exported APIs.
4. `AGENTS.md` — if agent-facing conventions, build steps, or security rules change.

---

## Debugging Guidelines

When something breaks:
1. Check `omnimind_status` MCP tool output.
2. Inspect the SQLite database directly: `sqlite3 ~/.omnimind/memory.db`
3. Enable debug logging: `DEBUG=omnimind:* npm start`
4. Run a specific test: `npm test -- --grep "test name"`
5. Profile hot paths with `console.time()` / `console.timeEnd()`.
