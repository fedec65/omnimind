# Omnimind Development Roadmap

## Phase 1: Core Memory Engine (Weeks 1-3)
**Status: IN PROGRESS**

Goal: A fast, local memory store with semantic search that rivals MemPalace's 96.6% R@5.

### Week 1: Foundation
- [x] Project scaffolding (TypeScript, build system, tests)
- [x] CLAUDE.md, AGENTS.md, ARCHITECTURE.md
- [ ] SQLite schema design (vectors, text, graph, metadata)
- [ ] SQLite + sqlite-vss integration
- [ ] EmbeddingEngine (ONNX all-MiniLM-L6-v2)
- [ ] Basic MemoryStore CRUD

### Week 2: Search
- [ ] Semantic search (vector similarity)
- [ ] Keyword search (FTS5)
- [ ] Hybrid search (semantic + keyword fusion)
- [ ] Temporal queries (time-range filtering)
- [ ] Benchmark: Achieve >= 96% R@5 on LongMemEval

### Week 3: Hierarchical Layers
- [ ] L0: VerbatimLayer implementation
- [ ] L1: CompressedLayer (AAAK-style shorthand)
- [ ] L2: ConceptGraph (entity-relationship extraction)
- [ ] L3: WisdomLayer (pattern distillation)
- [ ] AgingPipeline (lazy transitions between layers)
- [ ] Pin system (prevent aging for important memories)

### Deliverable: `npm test` passes, benchmarks >= 96% R@5

---

## Phase 2: Proactive Prediction (Weeks 4-5)

Goal: Memory that predicts what you need before you ask.

### Week 4: Activity Tracking
- [ ] ActivityTracker module
  - File change monitoring (safe patterns only)
  - Tool invocation history
  - Time-based pattern recognition
- [ ] Context vector construction (current state fingerprint)

### Week 5: Prediction Engine
- [ ] IntentPredictor (heuristic + lightweight classifier)
- [ ] Memory relevance scoring
- [ ] ContextInjector (pre-load into MCP context)
- [ ] Confidence threshold system (70% cutoff)
- [ ] Prediction accuracy benchmarks

### Deliverable: >= 70% prediction accuracy in simulated workflows

---

## Phase 3: Cross-Tool Memory Bus (Weeks 6-8)

Goal: One memory for Claude, ChatGPT, Cursor, and any MCP-compatible tool.

### Week 6: Bus Architecture
- [ ] MemoryBus core (pub/sub memory events)
- [ ] ConflictResolver (simple last-write-wins + manual merge)
- [ ] Memory event schema (create, update, delete, access)

### Week 7: Tool Adapters
- [ ] Claude Code adapter (hook integration)
- [ ] Cursor adapter (extension API)
- [ ] ChatGPT adapter (browser extension)

### Week 8: Sync & Conflict Resolution
- [ ] Cross-device sync protocol (encrypted P2P)
- [ ] Memory merge strategies (automatic + manual)
- [ ] Sync conflict UI indicators

### Deliverable: Memories created in Claude Code appear in Cursor automatically

---

## Phase 4: Visual Memory Explorer (Weeks 9-11)

Goal: A GUI that lets you see, explore, and manage your memory.

### Week 9: Desktop Shell
- [ ] Tauri project setup
- [ ] Svelte frontend scaffold
- [ ] IPC bridge (Rust ↔ TypeScript)

### Week 10: Views
- [ ] Spatial memory map (palace visualization)
- [ ] Temporal timeline (when did I learn X?)
- [ ] Concept graph (relationship explorer)
- [ ] Search interface (natural language queries)

### Week 11: Interaction
- [ ] Drag-and-drop memory organization
- [ ] Manual memory editing
- [ ] Import/export (JSON, Markdown)
- [ ] Settings & configuration

### Deliverable: Cross-platform desktop app (Windows, macOS, Linux)

---

## Phase 5: MCP Server & Integration (Weeks 12-13)

Goal: Seamless integration with any MCP-compatible AI tool.

### Week 12: MCP Server
- [ ] Full MCP server implementation (@modelcontextprotocol/sdk)
- [ ] Tool definitions (Zod schemas)
- [ ] Resource exposure (memory as readable resources)
- [ ] Prompt templates (memory-aware system prompts)

### Week 13: Polish
- [ ] Auto-save hooks for Claude Code
- [ ] Context compression with memory awareness
- [ ] Multi-agent memory isolation (each agent gets its own namespace)
- [ ] Documentation and examples

### Deliverable: Published npm package with `npx omnimind` one-liner setup

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

| Metric | Phase 1 | Phase 5 (MVP) | Phase 8 |
|--------|---------|---------------|---------|
| Retrieval R@5 | >= 96% | >= 97% | >= 98% |
| Retrieval latency | < 20ms | < 15ms | < 10ms |
| Prediction accuracy | N/A | >= 70% | >= 85% |
| Wake-up tokens | N/A | < 150 | < 100 |
| Storage growth | Linear | Sub-linear | Sub-linear |
| Tools supported | 1 (MCP) | 3+ | 5+ |
| Test coverage | >= 80% | >= 85% | >= 90% |

---

## Current Sprint

**Sprint 1 (Week 1): Foundation**
Priority: SQLite schema + EmbeddingEngine

Blocked by: None
Blocking: Everything else

Focus areas:
1. Design the unified SQLite schema (vectors + text + graph in one DB)
2. Get ONNX embedding model running in Node.js
3. Basic CRUD operations on MemoryStore
4. Test infrastructure with vitest

Definition of done:
- `npm test` passes with >= 80% coverage
- Can store and retrieve a memory with vector search
- Embedding runs locally without Python
- Schema supports all 4 layer types
