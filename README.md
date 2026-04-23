# Omnimind

> **Privacy-first, proactive memory for AI tools — 100% local, zero API calls.**

![Omnimind Banner](assets/omnimind-banner.png)

Omnimind is a local memory engine that stores, searches, and predicts relevant context across your AI tools (Claude Code, Cursor, ChatGPT, etc.) via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/). It runs entirely on your machine: embeddings, search, compression, and encryption are all local.

## Why Omnimind?

| | Traditional Memory | **Omnimind** |
|---|---|---|
| **Retrieval** | Reactive search | **Proactive prediction** |
| **Storage** | Flat, verbatim forever | **Hierarchical aging** (L0→L3) |
| **Scope** | Single tool | **Cross-tool via MCP** |
| **Privacy** | Cloud APIs | **100% local, encrypted at rest** |
| **Cost** | $0.001–$0.01 per write | **$0** (zero-LLM write path) |

## Architecture

```
┌─────────────────────────────────────────┐
│  PREDICTION LAYER                       │  ← < 5ms intent prediction
│  - Activity fingerprinting              │
│  - Context-aware pre-fetch              │
├─────────────────────────────────────────┤
│  MCP SERVER                             │  ← Claude, Cursor, any MCP client
│  - omnimind_search                      │
│  - omnimind_store                       │
│  - omnimind_predict                     │
│  - omnimind_status                      │
├─────────────────────────────────────────┤
│  NEURO-SYMBOLIC MEMORY CORE             │
│  ├─ L0: Verbatim     (0–7 days)        │
│  ├─ L1: Compressed   (7–30 days)        │  ← Rule-based shorthand
│  ├─ L2: Concept Graph (30–180 days)     │  ← Entity extraction
│  └─ L3: Wisdom       (180+ days)        │  ← Pattern distillation
├─────────────────────────────────────────┤
│  LOCAL SQLITE + ONNX                    │
│  - FTS5 keyword search                  │
│  - Vector search (384-dim embeddings)   │
│  - AES-256-GCM encryption at rest       │
└─────────────────────────────────────────┘
```

Every memory exists simultaneously as **text**, **vector embedding**, and **knowledge graph** — kept in sync automatically.

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Initialize (creates ~/.omnimind/)
npx omnimind init

# Store a memory
npx omnimind store "Use GraphQL not REST for the API" --wing project-alpha --room architecture

# Search memories
npx omnimind search "API architecture decision"

# Get predictions for current context
npx omnimind predict
```

**First run** downloads the ~80MB ONNX model (`all-MiniLM-L6-v2`) from Hugging Face. All subsequent operations are fully offline.

## CLI Commands

| Command | Description |
|---------|-------------|
| `init` | Create data directory and initialize database |
| `store <content>` | Store a new memory with optional `--wing`, `--room`, `--pin` |
| `search <query>` | Hybrid semantic + keyword search |
| `predict` | Predict relevant memories for current context |
| `status` | Show system stats and layer distribution |
| `mine <file.md>` | Import memories from a markdown file |
| `wipe --yes-i-am-sure` | Delete all memories (irreversible) |

### Encryption

Enable AES-256-GCM encryption with a passphrase:

```typescript
import { Omnimind } from 'omnimind';

const omni = await Omnimind.create({
  encryption: { passphrase: 'your-secret' }
});
```

Keys are derived from your machine fingerprint + optional passphrase via HKDF-SHA256. Without the passphrase, data is still encrypted with a machine-bound key.

## MCP Integration

Omnimind exposes 4 MCP tools for any compatible client:

| Tool | Input | Output |
|------|-------|--------|
| `omnimind_search` | `query`, `limit`, `wing`, `room` | Ranked memory list |
| `omnimind_store` | `content`, `wing`, `room`, `pin` | Stored memory ID |
| `omnimind_predict` | `projectPath`, `gitBranch`, `currentFile` | Top-3 predictions |
| `omnimind_status` | — | Stats, health, layer counts |

### Connecting to Claude Code

Add to your Claude Code settings:

```json
{
  "mcpServers": {
    "omnimind": {
      "command": "npx",
      "args": ["omnimind-mcp"]
    }
  }
}
```

## Development

```bash
# Install
npm install

# Type-check
npm run typecheck

# Build
npm run build

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Watch mode
npm run test:watch

# Lint
npm run lint

# Format
npm run format
```

### Test Coverage

- **55 tests** across 7 test files
- ~88% lines, ~90% functions, ~70% branches

## Tech Stack

| Layer | Technology |
|-------|------------|
| Language | TypeScript 5.5 (strict mode, `exactOptionalPropertyTypes`) |
| Runtime | Node.js ≥ 18 |
| Database | SQLite (`better-sqlite3`) with WAL mode, FTS5 |
| Embeddings | Local ONNX (`all-MiniLM-L6-v2`, 384-dim) |
| Vector Search | `sqlite-vss` (optional; brute-force fallback) |
| Encryption | AES-256-GCM + HKDF-SHA256 |
| MCP Protocol | `@modelcontextprotocol/sdk` |
| Validation | Zod |
| Testing | Vitest + v8 coverage |

## Security

- **No external API calls** during normal operation (model downloaded once on first run)
- **Encrypted at rest** — AES-256-GCM with authenticated encryption
- **Local-only** — Your data never leaves your machine
- **Parameterized SQL** — All queries use prepared statements
- **Privacy-first tracking** — Only hashes of project path, git branch, and file extension; never file contents or URLs

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the full phased plan.

**Completed (Phase 1):**
- ✅ SQLite-backed MemoryStore with CRUD
- ✅ Local ONNX embedding engine
- ✅ Hybrid search (vector + keyword + temporal boost)
- ✅ Hierarchical aging pipeline (L0→L3)
- ✅ Intent prediction (< 5ms)
- ✅ MCP server with 4 tools
- ✅ CLI with 7 commands
- ✅ AES-256-GCM encryption at rest
- ✅ 55 tests, ~88% coverage

**Upcoming:**
- Cross-tool memory bus
- Visual explorer GUI
- P2P sync
- Advanced NER for concept extraction

## License

MIT — See [LICENSE](LICENSE)
