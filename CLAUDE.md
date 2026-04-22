# Omnimind — Project Context

## What We're Building

Omnimind is a **proactive, cross-tool memory system for LLMs** that goes beyond simple storage-and-retrieval. It predicts what context you'll need before you ask, intelligently compresses memories over time (like human memory), and provides a unified memory layer across all your AI tools (Claude Code, ChatGPT, Cursor, Gemini, etc.).

## Core Philosophy

1. **Predict, don't just retrieve** — Pre-load relevant memories based on current activity patterns
2. **Memory ages intelligently** — Recent = verbatim, old = compressed, ancient = distilled wisdom
3. **One brain, many tools** — Cross-application unified memory via MCP protocol
4. **Neuro-symbolic representation** — Text + knowledge graph + latent concepts
5. **100% local, privacy-first** — Zero external API calls, user-owned data

## Architecture Overview

```
┌─────────────────────────────────────────┐
│  PREDICTION LAYER (lightweight local)   │  ← Pre-fetches likely memories
│  - Activity pattern tracker             │
│  - Intent prediction model              │
│  - Proactive context injector           │
├─────────────────────────────────────────┤
│  CROSS-TOOL BUS (MCP-based)             │  ← One memory for all AI tools
│  - Universal memory interface           │
│  - Tool adapters (Claude, GPT, Cursor)  │
│  - Sync & conflict resolution           │
├─────────────────────────────────────────┤
│  NEURO-SYMBOLIC MEMORY CORE             │
│  ├─ L0: Verbatim Layer (0-7 days)      │
│  ├─ L1: Compressed Layer (1-4 weeks)    │  ← Hierarchical aging
│  ├─ L2: Concept Graph (1-6 months)      │
│  └─ L3: Wisdom Layer (6+ months)        │
├─────────────────────────────────────────┤
│  VISUAL MEMORY EXPLORER GUI             │  ← Interactive memory map
│  - Spatial memory navigation            │
│  - Temporal timeline view               │
│  - Concept relationship graph           │
│  - Search & query interface             │
└─────────────────────────────────────────┘
```

## Tech Stack

- **Language:** TypeScript (Node.js runtime)
- **Vector DB:** SQLite + sqlite-vss (local, zero external deps)
- **Knowledge Graph:** SQLite with custom triple store
- **Embedding:** Local ONNX models (all-MiniLM-L6-v2 via onnxruntime-node)
- **MCP Server:** @modelcontextprotocol/sdk
- **GUI:** Tauri (Rust) + Svelte frontend (cross-platform desktop)
- **Prediction:** Simple heuristic + ONNX classifier (no LLM calls)

## Project Structure

```
omnimind/
├── CLAUDE.md              ← You are here (project context)
├── AGENTS.md              ← Agent behavior rules
├── ROADMAP.md             ← Development phases
├── ARCHITECTURE.md        ← Detailed technical design
├── package.json           ← Dependencies & scripts
├── tsconfig.json          ← TypeScript config
├── src/
│   ├── core/              ← Memory core engine
│   │   ├── MemoryStore.ts
│   │   ├── EmbeddingEngine.ts
│   │   ├── SearchEngine.ts
│   │   └── types.ts
│   ├── layers/            ← Hierarchical memory layers
│   │   ├── VerbatimLayer.ts
│   │   ├── CompressedLayer.ts
│   │   ├── ConceptGraph.ts
│   │   ├── WisdomLayer.ts
│   │   └── AgingPipeline.ts
│   ├── prediction/        ← Proactive prediction
│   │   ├── ActivityTracker.ts
│   │   ├── IntentPredictor.ts
│   │   └── ContextInjector.ts
│   ├── bus/               ← Cross-tool memory bus
│   │   ├── MemoryBus.ts
│   │   ├── ToolAdapter.ts
│   │   ├── adapters/
│   │   │   ├── ClaudeAdapter.ts
│   │   │   ├── ChatGPTAdapter.ts
│   │   │   └── CursorAdapter.ts
│   │   └── ConflictResolver.ts
│   ├── gui/               ← Visual explorer
│   │   ├── server.ts
│   │   └── api/
│   ├── mcp/               ← MCP server implementation
│   │   └── server.ts
│   └── index.ts           ← Main entry point
├── tests/                 ← Test suites
└── docs/                  ← Documentation
```

## Key Design Decisions

### 1. Why TypeScript over Python?
- Better MCP ecosystem support (TypeScript SDK is first-class)
- Easier cross-platform desktop distribution (Tauri + npm)
- Stronger typing for complex neuro-symbolic data structures
- Many target tools (Cursor, Claude Desktop) are TS-native

### 2. Why SQLite + sqlite-vss over ChromaDB?
- Zero additional dependencies (single-file database)
- Works on all platforms including mobile
- SQL knowledge is ubiquitous
- Can store vectors, text, AND graph in ONE database

### 3. Why ONNX over Python sentence-transformers?
- No Python runtime required
- Faster inference via native bindings
- Smaller bundle size
- Easier distribution (no conda/pip hell)

## Benchmark Targets

| Benchmark | Target | MemPalace Score |
|-----------|--------|-----------------|
| LongMemEval R@5 | >= 96% | 96.6% |
| Memory retrieval latency | < 20ms | ~50ms |
| Prediction accuracy | >= 70% | N/A (they don't predict) |
| Context bloat (wake cost) | < 150 tokens | ~170 tokens |
| Storage growth | Sub-linear | Linear |

## Current Development Phase

**Phase 1: Core Memory Engine** (IN PROGRESS)
- [x] Project scaffolding
- [ ] MemoryStore with SQLite backend
- [ ] Embedding engine (ONNX)
- [ ] Basic search (semantic + keyword)
- [ ] Hierarchical layer system

## How to Work on This Project

1. Always check ROADMAP.md for current phase priorities
2. Follow the architecture in ARCHITECTURE.md for design decisions
3. Maintain 100% local operation — never add external API dependencies
4. Write tests for every core component
5. Keep wake-up token cost under 150 tokens
6. Run `npm test` before committing changes

## Critical Constraints

- **ZERO external API calls** — Everything runs locally
- **Sub-20ms retrieval** — Users won't tolerate slow memory
- **Sub-linear storage** — Hierarchical aging must control storage growth
- **MCP-native** — All integrations go through MCP protocol
- **Cross-platform** — Windows, macOS, Linux from day one
