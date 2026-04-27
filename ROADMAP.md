# Omnimind Development Roadmap

## Phase 1: Core Memory Engine
**Status: COMPLETE** ✅

Goal: A fast, local memory store with semantic search.

### Delivered
- [x] Project scaffolding (TypeScript strict, Vitest, build system)
- [x] SQLite unified schema (vectors, text, graph, metadata, activity log)
- [x] SQLite + sqlite-vss integration (ARM64 native build)
- [x] EmbeddingEngine (ONNX all-MiniLM-L6-v2, 384d) — runs locally, no Python
- [x] MemoryStore CRUD with `Result<T,E>` pattern
- [x] Semantic search (vector similarity via sqlite-vss)
- [x] Keyword search (FTS5)
- [x] Hybrid search (vector + keyword + graph fusion with reciprocal rank)
- [x] Temporal queries (time-range filtering + temporal half-life boost)
- [x] Turn-level storage (`storeTurns()`) with batch embedding and shared `sourceId`
- [x] L0: VerbatimLayer — full text, immediate storage
- [x] L1: CompressedLayer — AAAK-style shorthand compression
- [x] L2: ConceptGraph — entity-relationship extraction + graph persistence
- [x] L3: WisdomLayer — pattern distillation
- [x] AgingPipeline — lazy transitions between layers (triggered on access)
- [x] Pin system — prevent aging for important memories
- [x] Import/Export — lossless JSON + human-readable Markdown

### Benchmarks
- **Retrieval R@5: 94%** on LongMemEval-S (turn-level) / 84% (session-level)
- **Retrieval latency: < 20ms** (p95)
- **Test coverage: 135 tests passing**

---

## Phase 2: Proactive Prediction
**Status: COMPLETE** ✅

Goal: Memory that predicts what you need before you ask.

### Delivered
- [x] ActivityTracker — file change monitoring, tool invocation history, time patterns
- [x] Context fingerprint construction (project, branch, file, time, recent tools)
- [x] IntentPredictor — exact + similar signature matching, frequency/recency scoring
- [x] Memory relevance scoring with confidence threshold (70% cutoff)
- [x] ContextInjector — pre-load predictions into MCP context
- [x] PatternStore with SQLite persistence

### Benchmarks
- **Top-1 accuracy: 73.9%** (target: ≥70%) ✅
- **Top-3 accuracy: 91.3%**
- **Wake-up tokens: < 150** (context injection is lightweight)

---

## Phase 3: Cross-Tool Memory Bus
**Status: IN PROGRESS** 🔄

Goal: One memory for Claude, ChatGPT, Cursor, and any MCP-compatible tool.

### Delivered
- [x] MemoryBus core — pub/sub event routing with vector clocks
- [x] ConflictResolver — tool-priority tiebreaking + supersede resolution
- [x] Memory event schema (create, update, delete, access, sync_request)
- [x] Dead-letter queue for failed routing
- [x] **Claude Code adapter** — file watch on `~/.claude/projects`, auto-save turns from `.jsonl`, decision extraction, CLAUDE.md notifications
- [x] **Cursor adapter** — file watch on `~/.cursor/conversations`, supports `.jsonl` + `.json` formats, auto-save turns
- [x] **ChatGPT adapter** — file watch on `~/.chatgpt/exports`, parses official OpenAI export format (message tree → flat turns), multi-part content support
- [x] `MemoryBus.storeTurns()` — direct batch storage bypassing event pipeline

### Remaining
- [ ] Cross-device sync protocol (encrypted P2P)
- [ ] Sync conflict UI indicators
- [ ] Memory merge strategies UI (automatic + manual)

### Deliverable
Memories created in Claude Code appear in Cursor automatically via shared MemoryStore.

---

## Phase 4: Visual Memory Explorer
**Status: IN PROGRESS** 🔄

Goal: A GUI that lets you see, explore, and manage your memory.

### Delivered
- [x] Tauri desktop shell + Svelte 5 frontend
- [x] IPC bridge (Node.js sidecar server on localhost:8844)
- [x] Search interface — natural language queries with hybrid results
- [x] Temporal timeline — chronological memory view
- [x] Concept graph — D3.js force-directed entity-relationship visualization
- [x] **Spatial memory map** — 2D wing/room layout (memory palace), zoom/pan, layer-colored dots, detail sidebar
- [x] Import/export UI (JSON + Markdown)
- [x] Settings panel — theme, auto-start, configuration

### Remaining
- [ ] Drag-and-drop card repositioning in spatial map
- [ ] Connection lines between related memories in spatial map
- [ ] Manual memory editing (double-click to edit)
- [ ] Real-time predictions panel in GUI

### Deliverable
Cross-platform desktop app (macOS primary, Linux/Windows via Tauri).

---

## Phase 5: MCP Server & Integration
**Status: IN PROGRESS** 🔄

Goal: Seamless integration with any MCP-compatible AI tool.

### Delivered
- [x] Full MCP server implementation (`@modelcontextprotocol/sdk`)
- [x] Tool definitions with Zod schemas:
  - `omnimind_search` — semantic search across all layers
  - `omnimind_store` — store new memory with auto-layering
  - `omnimind_store_conversation` — batch store conversation turns
  - `omnimind_predict` — get predicted memories for current context
  - `omnimind_status` — system health and layer statistics
  - `omnimind_subscribe` — subscribe to memory events
  - `omnimind_sync` — sync with other tools
- [x] Auto-save hooks for Claude Code (turn-level file watching)
- [x] Context injection endpoint (`/api/context`)

### Remaining
- [ ] Multi-agent memory isolation (each agent gets its own namespace/wing prefix)
- [ ] Memory-aware context compression (truncate while preserving Omnimind context)
- [ ] Prompt templates (memory-aware system prompts)
- [ ] Resource exposure (memory as readable MCP resources)
- [ ] Published npm package with `npx omnimind` one-liner setup

---

## Future Phases (Post-MVP)

### Phase 6: Team Memory (Month 4)
- Multi-user memory spaces with access controls
- Shared project memories
- Memory permissions (read/write/admin)
- Audit logging

### Phase 7: Advanced Neuro-Symbolic (Month 5)
- Latent concept space (beyond embeddings)
- Cross-modal memory (code + docs + conversations)
- Memory inference (deduce new facts from stored ones)
- Analogical reasoning ("this situation is like that past one")

### Phase 8: Memory Marketplace (Month 6)
- Import domain knowledge packs
- Share memory templates
- Community-curated wisdom libraries

---

## Success Metrics

| Metric | Current | Phase 5 (MVP) | Phase 8 |
|--------|---------|---------------|---------|
| Retrieval R@5 | **94%** | >= 97% | >= 98% |
| Retrieval latency | **< 20ms** | < 15ms | < 10ms |
| Prediction accuracy | **73.9%** top-1 | >= 75% | >= 85% |
| Wake-up tokens | **< 150** | < 150 | < 100 |
| Storage growth | Linear | Sub-linear | Sub-linear |
| Tools supported | **3** (Claude, Cursor, ChatGPT) | 3+ | 5+ |
| Test coverage | **135 tests** | >= 85% | >= 90% |

---

## Current Sprint

**Sprint: MCP Polish + Multi-Agent Isolation**

Priority: Multi-agent namespace isolation + context compression

Blocked by: None
Blocking: npm package publish

Focus areas:
1. Multi-agent memory isolation (namespace prefixes per agent)
2. Context compression that preserves Omnimind predictions
3. npm package preparation (`npx omnimind` setup)
4. Documentation update (README, API docs, integration guides)

Definition of done:
- Each MCP client can operate in its own memory namespace
- Context injection respects token budget and compresses gracefully
- `npm test` passes with >= 85% coverage
- Package ready for `npm publish` (dry-run passes)
