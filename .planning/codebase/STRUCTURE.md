# Codebase Structure

**Analysis Date:** 2026-06-18

## Directory Layout

```
omnimind/
├── src/                       # Node.js library and process entry points
│   ├── index.ts               # Omnimind class — main library API
│   ├── cli.ts                 # `omnimind` CLI entry
│   ├── server.ts              # `omnimind-server` HTTP REST entry
│   ├── mcp-server.ts          # `omnimind-mcp` stdio entry (one-line bootstrap)
│   ├── core/                  # Domain primitives and storage engine
│   │   ├── MemoryStore.ts     # SQLite CRUD, hybrid search, archive, graph
│   │   ├── EmbeddingEngine.ts # Local 384-dim sentence embeddings
│   │   ├── SearchEngine.ts    # Vector + keyword + graph search and fusion
│   │   ├── CryptoEngine.ts    # AES-256-GCM at-rest encryption
│   │   ├── RelationExtractor.ts # Heuristic SVO triple extractor
│   │   └── types.ts           # Domain interfaces, enums, time constants
│   ├── layers/
│   │   └── AgingPipeline.ts   # L0 -> L1 -> L2 -> L3 layer transitions
│   ├── prediction/
│   │   ├── IntentPredictor.ts # Pattern learning and candidate matching
│   │   ├── PatternStore.ts    # SQLite persistence for patterns
│   │   ├── ActivityTracker.ts # File watcher + bus-event subscriber
│   │   └── ContextInjector.ts # Token-budgeted XML injection formatter
│   ├── bus/
│   │   ├── MemoryBus.ts       # Pub/sub broker with vector clock
│   │   ├── ConflictResolver.ts # Temporal+priority conflict resolution
│   │   ├── types.ts           # Bus interfaces, event types, tool priority
│   │   └── adapters/
│   │       ├── BaseAdapter.ts       # Abstract base (lifecycle, heartbeat)
│   │       ├── ClaudeAdapter.ts     # Claude Code `.jsonl` watcher
│   │       ├── ClaudeDesktopAdapter.ts # Claude Desktop sessions watcher
│   │       ├── CursorAdapter.ts     # Cursor conversation watcher
│   │       └── ChatGPTAdapter.ts    # ChatGPT export watcher
│   └── mcp/
│       └── server.ts          # MCP stdio server (tools/resources/prompts)
├── gui/                       # Svelte 5 web frontend
│   ├── src/
│   │   ├── App.svelte         # Shell: health polling, tabs, update banner
│   │   ├── main.ts            # mount() entry
│   │   └── lib/
│   │       ├── api.ts         # Typed fetch client for /api/*
│   │       ├── stores.svelte.ts # Svelte 5 `$state` global app state
│   │       ├── updates.ts     # GitHub release checker (24h throttled)
│   │       ├── Counter.svelte # Sample counter (legacy/placeholder)
│   │       └── components/    # One .svelte per tab + shared cards
│   │           ├── SearchPanel.svelte
│   │           ├── StatsPanel.svelte
│   │           ├── TimelineView.svelte
│   │           ├── GraphView.svelte     # D3 force-directed graph
│   │           ├── SpatialMap.svelte
│   │           ├── SettingsPanel.svelte
│   │           ├── ArchivePanel.svelte
│   │           ├── PredictionsPanel.svelte
│   │           ├── ConflictsPanel.svelte
│   │           └── MemoryCard.svelte
│   ├── package.json           # Vite + Svelte 5 + D3 + Tailwind
│   ├── vite.config.ts
│   └── tailwind.config.js
├── src-tauri/                 # Tauri 2 native shell
│   ├── Cargo.toml             # Rust crate
│   ├── tauri.conf.json        # Bundle config, capabilities, CSP
│   └── src/
│       └── main.rs            # Spawns Node sidecar, manages child lifecycle
├── tests/                     # Vitest test suites (mirrors src/ layout)
│   ├── core/
│   ├── bus/
│   ├── layers/
│   ├── prediction/
│   ├── integration/
│   └── server/
├── scripts/
│   ├── download-model.js      # postinstall: fetch embedding model
│   ├── force-l2-aging.ts      # CLI to bulk-age memories
│   ├── prepare-resources.sh   # Bundle Node binary and assets
│   └── prune-for-bundle.js    # Reduce bundle size
├── coverage/                  # Vitest coverage output (generated)
├── dist/                      # TypeScript build output (generated)
├── gui/dist/                  # Vite build output (generated, served by server.ts)
├── package.json               # Root package — 3 bins: omnimind, omnimind-mcp, omnimind-server
├── tsconfig.json              # strict, NodeNext, exactOptionalPropertyTypes
├── vitest.config.ts
├── README.md
├── ROADMAP.md
└── AGENTS.md                  # Repo-wide agent operating instructions
```

## Directory Purposes

**`src/core/`:**
- Purpose: Foundational storage and domain types. Every other layer depends on `core/types.ts`. The only directory that touches SQLite or the embedding model directly.
- Contains: Type definitions, the 1872-line `MemoryStore`, `EmbeddingEngine`, `SearchEngine`, `CryptoEngine`, `RelationExtractor`.
- Key files: `src/core/MemoryStore.ts` (CRUD/search/archive/graph), `src/core/types.ts` (every public interface).

**`src/layers/`:**
- Purpose: Memory-aging logic that mutates content as memories age out of each layer.
- Contains: `AgingPipeline` (the only production class), `AgingScheduler` (stub).
- Key files: `src/layers/AgingPipeline.ts`.

**`src/prediction/`:**
- Purpose: Proactive context-aware memory retrieval — the "wake-up" system that feeds memories into the LLM before it asks.
- Contains: `IntentPredictor` (pattern learner), `PatternStore` (durable pattern cache), `ActivityTracker` (sliding-window context builder from filesystem and bus), `ContextInjector` (formats predictions as compact XML).
- Key files: `src/prediction/IntentPredictor.ts`, `src/prediction/ContextInjector.ts`.

**`src/bus/`:**
- Purpose: Cross-tool memory event fan-in/fan-out.
- Contains: `MemoryBus` (central broker), `ConflictResolver` (vector-clock comparison), `types.ts` (event/subscription interfaces, `ToolPriority`), `adapters/` (one per external tool).
- Key files: `src/bus/MemoryBus.ts`, `src/bus/adapters/BaseAdapter.ts`.

**`src/mcp/`:**
- Purpose: Model Context Protocol surface. Independent of the `Omnimind` facade — constructs `MemoryStore`/`IntentPredictor`/`MemoryBus` directly to keep the MCP-only deployment lean.
- Contains: `OmnimindMcpServer` class with all tool/resource/prompt handlers.
- Key files: `src/mcp/server.ts`.

**`gui/`:**
- Purpose: Browser-based visual explorer. Built with Vite + Svelte 5 + Tailwind + D3.
- Contains: App shell, typed API client, single reactive store, one component per tab.
- Key files: `gui/src/App.svelte`, `gui/src/lib/api.ts`, `gui/src/lib/stores.svelte.ts`, `gui/src/lib/updates.ts`.

**`src-tauri/`:**
- Purpose: Native desktop wrapper that spawns the Node HTTP server as a sidecar child process.
- Contains: A single `main.rs` (~150 lines) that finds a free port, prefers the bundled Node binary, falls back to system Node, and kills the child on window destroy.
- Key files: `src-tauri/src/main.rs`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`.

**`scripts/`:**
- Purpose: Build and maintenance utilities invoked by `package.json` lifecycle scripts.
- Contains: `download-model.js` (postinstall — fetches embedding model), `prepare-resources.sh` (bundles Node binary), `prune-for-bundle.js` (removes unused files), `force-l2-aging.ts` (debug tool).

**`tests/`:**
- Purpose: Vitest suites. Mirrors `src/` structure.
- Contains: `tests/core/`, `tests/bus/`, `tests/layers/`, `tests/prediction/`, `tests/integration/`, `tests/server/`.

## Key File Locations

**Entry Points:**
- `src/index.ts:93` — `Omnimind` class, `Omnimind.create()` static factory at `:125`.
- `src/cli.ts:23` — `omnimind` CLI dispatcher.
- `src/server.ts:54` — HTTP server bootstrap.
- `src/mcp-server.ts:16` — MCP stdio bootstrap.
- `src-tauri/src/main.rs:21` — Tauri shell.
- `gui/src/main.ts` — Browser mount.

**Configuration:**
- `package.json` — Root package, declares three bins (`omnimind`, `omnimind-mcp`, `omnimind-server`), deps, scripts.
- `tsconfig.json` — TypeScript strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`.
- `vitest.config.ts` — Test runner.
- `gui/package.json` — Vite/Svelte/Tailwind/D3 frontend.
- `gui/vite.config.ts`, `gui/tailwind.config.js`, `gui/svelte.config.js`.
- `src-tauri/tauri.conf.json` — Bundle targets (`app`, `dmg`, `msi`, `appimage`, `deb`), identifier `com.omnimind.app`.
- `src-tauri/Cargo.toml` — Rust deps (tauri 2 with `tray-icon`, `tauri-plugin-shell`).

**Core Logic:**
- `src/core/MemoryStore.ts:222` — `MemoryStore` class (1872 lines).
- `src/core/MemoryStore.ts:303` — `store()` (single memory).
- `src/core/MemoryStore.ts:404` — `storeTurns()` (batch conversation).
- `src/core/MemoryStore.ts:680` — `search()` (hybrid).
- `src/core/MemoryStore.ts:969` — `evictStaleMemories()` (to archive).
- `src/core/MemoryStore.ts:1247` — `aggregateWisdomPatterns()`.
- `src/core/SearchEngine.ts:34` — `SearchEngine` class.
- `src/core/EmbeddingEngine.ts:50` — `EmbeddingEngine` class.
- `src/core/CryptoEngine.ts:41` — `CryptoEngine` class.
- `src/core/RelationExtractor.ts:47` — `extractRelations()` function.
- `src/core/types.ts` — All shared interfaces (`Memory`, `SearchResult`, `Entity`, `Relation`, `Result`).

**Testing:**
- `tests/` — Vitest suites.
- `vitest.config.ts` — Run config; `npm test` executes `vitest run`, `npm run test:watch` runs watch mode, `npm run test:coverage` produces V8 coverage.

## Naming Conventions

**Files:**
- TypeScript source: PascalCase for class files (`MemoryStore.ts`, `IntentPredictor.ts`), lowercase for utility modules (`types.ts`, `api.ts`), `kebab-case` for multi-word scripts (`download-model.js`, `force-l2-aging.ts`).
- Svelte components: PascalCase with `.svelte` extension (`SearchPanel.svelte`).
- Generated/build output: lowercase (`dist/`, `gui/dist/`, `coverage/`).

**Directories:**
- All lowercase, single-word where possible (`core`, `bus`, `layers`, `prediction`, `mcp`, `scripts`, `tests`).
- The `src-tauri/` directory uses the Tauri convention of a hyphenated root + Rust source under `src/`.

**Classes:** PascalCase, noun phrases (`MemoryStore`, `SearchEngine`, `IntentPredictor`, `ConflictResolver`, `BaseAdapter`).
**Functions:** camelCase, verb phrases (`buildFingerprint`, `extractRelations`, `formatPredictions`).
**Types/interfaces:** PascalCase, noun phrases (`Memory`, `MemoryEvent`, `ContextFingerprint`, `ToolAdapter`).
**Constants:** SCREAMING_SNAKE_CASE for exported objects (`MemoryLayer`, `ToolPriority`, `AgingThresholds`, `DefaultSearchConfig`).
**DB columns:** snake_case (`created_at`, `access_count`, `source_tool`, `concept_refs`).

## Where to Add New Code

**New tool adapter (e.g. "WindsurfAdapter"):**
- Implementation: `src/bus/adapters/WindsurfAdapter.ts` (extend `BaseAdapter`).
- Type registration: nothing in `bus/types.ts` unless adding a new capability or event subtype.
- Wiring: `src/index.ts` in `Omnimind.create()` after the existing four adapter registrations; also `src/mcp/server.ts` in `init()`.
- Tests: `tests/bus/WindsurfAdapter.test.ts`.

**New MCP tool:**
- Schema: `src/mcp/server.ts` — add a Zod schema after line 91 and a tool entry in `setupHandlers` after line 211.
- Handler: `src/mcp/server.ts` — add a `handleX` method and a `case 'omnimind_x':` branch in the `CallToolRequestSchema` switch (line 215).
- Tests: `tests/mcp/` or `tests/server/`.

**New HTTP endpoint:**
- Add a `if (path === '/api/x' && method === 'GET')` block in `src/server.ts:handleRequest` (before line 547).
- Mirror it in `gui/src/lib/api.ts` so the GUI can call it.
- Tests: `tests/server/`.

**New memory layer (hypothetical L4):**
- `src/core/types.ts` — extend `MemoryLayer` enum, add `AgingThresholds[L4]`, update `StoreStats.memoriesByLayer` shape if needed.
- `src/layers/AgingPipeline.ts` — add a `distillToL4` method and a case in `transition`.
- `src/index.ts` — extend `checkAging` if the new layer needs special handling.
- `src/server.ts` and `gui/` — update any layer-name arrays (e.g. `['Verbatim', 'Compressed', 'Concept', 'Wisdom']`).

**New GUI tab:**
- Component: `gui/src/lib/components/MyTab.svelte`.
- Registration: `gui/src/App.svelte` — add an entry to the `nav` array (line 83) and an `{:else if appState.activeTab === 'mytab'}` branch (line 127).
- Type: extend the `activeTab` union in `gui/src/lib/stores.svelte.ts` (line 4).

**New settings key:**
- Read via `omni.getSetting('myKey')` anywhere in Node code.
- Set via `omni.setSetting('myKey', value)` or `POST /api/settings`.
- Persisted automatically in the SQLite `settings` table.

**New CLI subcommand:**
- `src/cli.ts` — add an entry to the `commands` object (line 27) and an async function.

**New entity type:**
- `src/core/types.ts` — extend `EntityType` union (line 86).
- `src/server.ts` — extend `validEntityTypes` array (line 279).
- `gui/src/lib/components/GraphView.svelte` — add a color entry to `typeColors` (line 16).

## Special Directories

**`dist/`:**
- Purpose: TypeScript build output (`tsc`).
- Generated: Yes (`npm run build`).
- Committed: Yes — `package.json` `files` array includes `dist/` because the npm package ships pre-built JS.

**`gui/dist/`:**
- Purpose: Vite-built frontend assets.
- Generated: Yes (`npm run gui:build` or `vite build`).
- Committed: Yes — bundled into the npm tarball and served by `src/server.ts:serveStatic` at runtime.

**`coverage/`:**
- Purpose: Vitest coverage reports.
- Generated: Yes (`npm run test:coverage`).
- Committed: No (excluded by `.gitignore`).

**`node_modules/`:**
- Purpose: npm dependencies.
- Generated: Yes (`npm install`).
- Committed: No.

**`src-tauri/target/`:**
- Purpose: Rust build output.
- Generated: Yes (`cargo build` / `tauri build`).
- Committed: No.

**`src-tauri/resources/.cache/Xenova/all-MiniLM-L6-v2/`:**
- Purpose: Bundled HuggingFace model files for the embedding engine (avoids download on first launch).
- Generated: No — committed.
- Committed: Yes.

**`src-tauri/resources/node/`:**
- Purpose: Node.js binary bundled inside the desktop installer so the app does not require a system Node.
- Generated: Built by `scripts/prepare-resources.sh`.
- Committed: Yes (binary, large).

**`assets/`:**
- Purpose: Repo-wide static assets (screenshots, icons for README).
- Generated: No.
- Committed: Yes.

**`benchmarks/`:**
- Purpose: Recall benchmarks referenced from `package.json`'s `benchmark` script.
- Generated: Some files generated by running benchmarks.
- Committed: Mostly yes — kept for reproducible benchmark results.

---

*Structure analysis: 2026-06-18*
