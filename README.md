# Omnimind

> **Proactive, cross-tool memory for LLMs — 100% local, zero API calls.**

Omnimind is a next-generation memory system that goes beyond simple storage-and-retrieval. It **predicts** what context you'll need before you ask, **intelligently compresses** memories over time, and provides a **unified memory layer** across all your AI tools.

## Why Omnimind?

| Feature | MemPalace | mem0 | **Omnimind** |
|---------|-----------|------|-------------|
| Retrieval | Reactive search | Reactive search | **Proactive prediction** |
| Storage | Verbatim forever | LLM-extracted | **Hierarchical aging** |
| Scope | Single tool | Cloud service | **Cross-tool universal** |
| Architecture | Flat + Palace | Flat + Graph | **Neuro-symbolic layers** |
| Scope | Python CLI | Cloud API | **TypeScript + MCP** |
| Prediction | No | No | **Yes (>= 70% accuracy)** |

## Quick Start

```bash
# Install globally
npm install -g omnimind

# Initialize
omnimind init

# Store a memory
omnimind store "Use GraphQL not REST for the API" --wing project-alpha --room architecture

# Search memories
omnimind search "API architecture decision"

# Get predictions for your current context
omnimind predict --project . --branch $(git branch --show-current)
```

## Architecture

```
┌─────────────────────────────────────────┐
│  PREDICTION LAYER                       │  ← Pre-fetches likely memories
│  - Activity pattern tracking            │
│  - Intent prediction (< 5ms)            │
│  - Proactive context injection          │
├─────────────────────────────────────────┤
│  CROSS-TOOL BUS (MCP)                   │  ← One memory for Claude, GPT, Cursor...
│  - Universal memory interface           │
│  - Tool adapters                        │
│  - Conflict resolution                  │
├─────────────────────────────────────────┤
│  NEURO-SYMBOLIC MEMORY CORE             │
│  ├─ L0: Verbatim (0-7 days)            │
│  ├─ L1: Compressed (7-30 days)          │  ← Hierarchical aging
│  ├─ L2: Concept Graph (30-180 days)     │
│  └─ L3: Wisdom (180+ days)              │
├─────────────────────────────────────────┤
│  LOCAL SQLITE + ONNX                    │  ← Zero external dependencies
│  - sqlite-vss for vector search         │
│  - FTS5 for keyword search              │
│  - Local embeddings (384-dim)           │
└─────────────────────────────────────────┘
```

## Core Principles

1. **Predict, don't just retrieve** — We pre-load relevant memories based on your current activity patterns
2. **Memory ages intelligently** — Like human memory: recent = vivid, old = compressed, ancient = wisdom
3. **One brain, many tools** — Works across Claude Code, ChatGPT, Cursor, Gemini via MCP
4. **Neuro-symbolic** — Every memory exists as text, knowledge graph, AND vector simultaneously
5. **100% local** — Zero external API calls. Your data never leaves your machine.

## Key Innovations

### Proactive Memory Prediction

Instead of waiting for you to search, Omnimind **predicts what you'll need**:

```typescript
const predictions = await omni.predict({
  projectPath: '/home/user/projects/alpha',
  gitBranch: 'feature/auth',
  currentFile: 'src/api.ts',
  recentTools: ['claude-code'],
});

// Automatically injected into context:
// <omnimind_predictions confidence="0.85">
// [project-alpha] Use GraphQL not REST for the API (confidence: 85%)
// </omnimind_predictions>
```

### Hierarchical Memory Aging

Memories automatically transition between layers over time:

| Layer | Age | Size | Example |
|-------|-----|------|---------|
| **L0 Verbatim** | 0-7 days | 100% | Full conversation text |
| **L1 Compressed** | 7-30 days | ~30% | "∴ use GraphQL ∵ REST too slow" |
| **L2 Concept** | 30-180 days | ~5% | `[Concept: GraphQL(api), REST(api)]` |
| **L3 Wisdom** | 180+ days | ~1% | `[Wisdom: prefer modern APIs > legacy]` |

### Zero-LLM Write Path

All storage operations use **local heuristics** — no LLM calls:
- Compression: Rule-based shorthand (60-80% reduction)
- Concept extraction: ONNX NER model
- Embeddings: Local all-MiniLM-L6-v2
- **Cost per write: $0** (vs $0.001-$0.01 for cloud solutions)

## MCP Integration

Omnimind exposes 4 MCP tools for any compatible client:

| Tool | Description |
|------|-------------|
| `omnimind_search` | Search memories by query |
| `omnimind_store` | Store new memory |
| `omnimind_predict` | Get predicted memories for context |
| `omnimind_status` | System health and stats |

## Development

```bash
# Clone and setup
git clone https://github.com/yourusername/omnimind.git
cd omnimind
npm install

# Run tests
npm test

# Run benchmarks
npm run benchmark

# Type check
npm run typecheck

# Lint
npm run lint
```

## Benchmark Targets

| Benchmark | Target | MemPalace |
|-----------|--------|-----------|
| LongMemEval R@5 | >= 97% | 96.6% |
| Retrieval latency | < 15ms | ~50ms |
| Prediction accuracy | >= 70% | N/A |
| Wake-up tokens | < 150 | ~170 |
| Storage growth | Sub-linear | Linear |

## Project Status

**Phase 1: Core Memory Engine** (IN PROGRESS)
- [x] Project scaffolding
- [x] Type definitions and architecture
- [x] MemoryStore with SQLite backend
- [x] EmbeddingEngine (ONNX)
- [x] SearchEngine (hybrid vector + keyword)
- [x] AgingPipeline (hierarchical layers)
- [x] IntentPredictor (activity-based)
- [x] MCP server
- [x] CLI interface
- [ ] Benchmark: LongMemEval >= 97% R@5
- [ ] Cross-tool bus
- [ ] Visual explorer GUI

## License

MIT — See [LICENSE](LICENSE)

## Acknowledgments

- Inspired by [MemPalace](https://github.com/MemPalace/mempalace)'s spatial architecture
- Embeddings via [sentence-transformers/all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)
- MCP protocol by [Anthropic](https://modelcontextprotocol.io/)
