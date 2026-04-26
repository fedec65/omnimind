# Omnimind

> **Privacy-first, proactive memory for AI tools — 100% local, zero API calls.**

![Omnimind Banner](assets/omnimind-banner.png)

Omnimind is a local memory engine that stores, searches, predicts, and visualizes relevant context across your AI tools (Claude Code, Cursor, ChatGPT, etc.) via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/). It runs entirely on your machine: embeddings, search, compression, and encryption are all local.

## Why Omnimind?

| | Traditional Memory | **Omnimind** |
|---|---|---|
| **Retrieval** | Reactive search | **Proactive prediction** |
| **Storage** | Flat, verbatim forever | **Hierarchical aging** (L0→L3) |
| **Scope** | Single tool | **Cross-tool via MCP + Bus** |
| **Exploration** | Terminal only | **Visual GUI (Tauri desktop)** |
| **Privacy** | Cloud APIs | **100% local, encrypted at rest** |
| **Cost** | $0.001–$0.01 per write | **$0** (zero-LLM write path) |

## Architecture

```
┌─────────────────────────────────────────┐
│  VISUAL EXPLORER                        │  ← Tauri + Svelte 5 desktop GUI
│  - Search, timeline, concept graph      │
│  - Drag-and-drop organization           │
├─────────────────────────────────────────┤
│  CROSS-TOOL MEMORY BUS                  │  ← MCP + event sync
│  - MemoryBus (pub/sub)                  │
│  - ConflictResolver                     │
│  - ClaudeAdapter (more coming)          │
├─────────────────────────────────────────┤
│  PREDICTION LAYER                       │  ← < 5ms intent prediction
│  - ActivityTracker (fs + bus watcher)   │
│  - PatternStore (SQLite persistence)    │
│  - ContextInjector (MCP resource)       │
├─────────────────────────────────────────┤
│  MCP SERVER                             │  ← Claude, Cursor, any MCP client
│  - omnimind_search                      │
│  - omnimind_store                       │
│  - omnimind_predict                     │
│  - omnimind_status                      │
│  - omnimind_subscribe                   │
│  - omnimind_sync                        │
│  - Resources + Prompts                  │
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

# Launch the desktop GUI
npm run gui:dev

# Start the HTTP server
npm run server
```

**First run** downloads the ~80MB ONNX model (`all-MiniLM-L6-v2`) from Hugging Face. All subsequent operations are fully offline.

## CLI Commands

| Command | Description |
|---------|-------------|
| `init` | Create data directory and initialize database |
| `store <content>` | Store a new memory with optional `--wing`, `--room`, `--pin` |
| `search <query>` | Hybrid semantic + keyword search |
| `predict` | Predict relevant memories for current context |
| `activity` | Show recent activity and prediction pattern stats |
| `inject` | Print formatted context injection string for current context |
| `status` | Show system stats and layer distribution |
| `mine <file.md>` | Import memories from a markdown file |
| `bus status` | Show connected tools and bus statistics |
| `bus sync [tool]` | Sync missed events from a specific tool |
| `bus conflicts` | List unresolved conflicts |
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

### Tools

| Tool | Input | Output |
|------|-------|--------|
| `omnimind_search` | `query`, `limit`, `wing`, `room` | Ranked memory list |
| `omnimind_store` | `content`, `wing`, `room`, `pin` | Stored memory ID |
| `omnimind_predict` | `projectPath`, `gitBranch`, `currentFile` | Top-3 predictions |
| `omnimind_status` | — | Stats, health, layer counts |
| `omnimind_subscribe` | `wings`, `rooms`, `eventTypes` | Subscription confirmation |
| `omnimind_sync` | `since`, `toolId` | Missed events list |

### Resources

| Resource | Description |
|----------|-------------|
| `omnimind://context/predictions` | Current predictions as JSON |
| `omnimind://stats/overview` | System health and statistics |

### Prompts

| Prompt | Description |
|--------|-------------|
| `memory-aware` | System prompt with injected memory predictions |

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

## HTTP API

Omnimind exposes a local REST API (default port `8844`) for the desktop GUI and external integrations:

```bash
# Start the server
npm run server
```

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Server health |
| `/api/memories` | GET | List memories (with filters) |
| `/api/memories` | POST | Create a memory |
| `/api/memories/:id` | GET | Get memory by ID |
| `/api/memories/:id` | DELETE | Delete memory |
| `/api/search` | GET | Hybrid search |
| `/api/predictions` | GET | Get predictions |
| `/api/stats` | GET | System statistics |
| `/api/context` | GET | Context injection string |
| `/api/bus/status` | GET | Bus statistics |
| `/api/bus/sync` | POST | Sync missed events |

## Desktop GUI

Omnimind Explorer is a cross-platform desktop app built with **Tauri v2** and **Svelte 5**.

```bash
# Development (hot reload)
npm run gui:dev

# Production build
npm run gui:build
```

**Features:**
- **Search** — Live hybrid search with filters
- **Timeline** — Chronological memory explorer
- **Concept Graph** — Relationship visualization (D3.js)
- **Stats** — Real-time system health in sidebar

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

# Start HTTP server
npm run server

# GUI dev mode
npm run gui:dev

# GUI production build
npm run gui:build
```

### Test Coverage

- **104 tests** across 14 test files
- ~90% lines, ~92% functions, ~75% branches

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
| **Desktop GUI** | **Tauri v2 + Svelte 5 + Vite + TailwindCSS** |
| **Charts** | **D3.js** |
| **HTTP Server** | **Node.js built-in (`node:http`)** |

## Security

- **No external API calls** during normal operation (model downloaded once on first run)
- **Encrypted at rest** — AES-256-GCM with authenticated encryption
- **Local-only** — Your data never leaves your machine
- **Parameterized SQL** — All queries use prepared statements
- **Privacy-first tracking** — Only hashes of project path, git branch, and file extension; never file contents or URLs

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the full phased plan.

**Completed:**
- ✅ **Phase 1:** SQLite-backed MemoryStore, ONNX embedding engine, hybrid search, hierarchical aging (L0→L3), MCP server, CLI
- ✅ **Phase 2:** ActivityTracker, PatternStore (SQLite persistence), ContextInjector (MCP resources/prompts), proactive prediction
- ✅ **Phase 3:** Cross-tool Memory Bus (MemoryBus, ConflictResolver, ClaudeAdapter), `omnimind_subscribe` + `omnimind_sync`
- ✅ **Phase 4:** Visual Memory Explorer (Tauri + Svelte 5 desktop GUI), HTTP REST API, Search/Timeline/Graph views

**Upcoming:**
- MCP polish (auto-save hooks, multi-agent isolation)
- P2P encrypted sync
- Advanced NER for concept extraction
- Team memory spaces

## License

MIT — See [LICENSE](LICENSE)
