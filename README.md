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
│  - Adapters: Claude Code, Claude        │
│    Desktop, Cursor, ChatGPT             │
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

## Installation

### Desktop App (Recommended)

Download the latest release for your platform — no Node.js or technical setup required.

| Platform | Download | Size |
|----------|----------|------|
| **macOS** (Apple Silicon) | `.dmg` | ~185 MB |
| **macOS** (Intel) | `.dmg` | ~186 MB |
| **Windows** | `.msi` installer | ~175 MB |
| **Linux** (Ubuntu/Debian) | `.deb` package | ~400 MB |

📦 **[Download v0.6.8](https://github.com/fedec65/omnimind/releases/latest)**

**First launch:**
1. Install the app (drag to Applications on macOS, run the installer on Windows, or `dpkg -i` on Linux)
2. Double-click to open — the app starts its bundled backend automatically (the ONNX model is included in the installer, nothing to download)
3. The Omnimind Explorer window opens with your memories

> **Shared memory store:** the desktop app, the MCP server, and the CLI all read and write the **same database** at `~/.omnimind/`. Memories stored by Claude Code or Cursor show up in the app, and vice versa — no import or sync needed. Override the location for any entry point with the `OMNIMIND_DATA_DIR` environment variable.

### CLI / npm (Developers)

For command-line usage, programmatic access, or MCP server integration:

```bash
# Install globally
npm install -g omnimind

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

### Development

```bash
# Clone and install dependencies
npm install

# Build TypeScript
npm run build

# Start HTTP server
npm run server

# Launch GUI in dev mode
npm run gui:dev
```

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
| `omnimind_search` | `query`, `limit`, `wing`, `room`, `namespace` | Ranked memory list (client-scoped) |
| `omnimind_store` | `content`, `wing`, `room`, `pin`, `namespace` | Stored memory ID (auto-tagged with client namespace) |
| `omnimind_predict` | `projectPath`, `gitBranch`, `currentFile` | Top-3 predictions |
| `omnimind_status` | — | Stats, health, layer counts, bound namespace |
| `omnimind_subscribe` | `wings`, `rooms`, `eventTypes` | Subscription confirmation |
| `omnimind_compress_context` | `history`, `tokenBudget` | Compressed text + summary, preserves `<omnimind_predictions>` |

**Multi-agent isolation:** each connected MCP client is bound to its own namespace derived from the `clientInfo` sent in the initialize handshake. Claude Code and Cursor running in parallel cannot see each other's memories via `omnimind_search` without an explicit `namespace` override.

**Memory-aware context compression:** `omnimind_compress_context` truncates a long chat history to a token budget while preserving every `<omnimind_predictions>` block byte-for-byte.

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

### Setting up MCP clients

Omnimind works with any MCP-compatible client. The server runs on stdio and is started by the client on demand.

**Prerequisite:** install the package globally so `omnimind-mcp` is on your PATH:

```bash
npm install -g omnimind
```

> **Node.js version note:** Omnimind ships a native module (`better-sqlite3`) that is compiled for a specific Node.js ABI. Install and run the MCP server with the **same Node.js version** (e.g. install with Node 20 → run with Node 20). If you switch Node versions, run `npm rebuild better-sqlite3 -g omnimind` — otherwise the server crashes with `NODE_MODULE_VERSION` mismatch. For maximum determinism, point your client config at an explicit Node binary and the global install (see Kimi Code example below).

#### Claude Code

The fastest way is the one-liner setup:

```bash
npx omnimind setup-claude-code
```

This writes the MCP server entry into `~/.claude/settings.json` automatically. After running it, restart Claude Code and Omnimind tools will appear. The setup is idempotent — running it again is safe and will not clobber other MCP server entries. Override the target path via `OMNIMIND_CLAUDE_SETTINGS_PATH=/path/to/settings.json npx omnimind setup-claude-code` for non-standard layouts.

Manual configuration — add this to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "omnimind": {
      "command": "npx",
      "args": ["-y", "omnimind-mcp"]
    }
  }
}
```

#### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "omnimind": {
      "command": "npx",
      "args": ["-y", "omnimind-mcp"]
    }
  }
}
```

#### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "omnimind": {
      "command": "npx",
      "args": ["-y", "omnimind-mcp"]
    }
  }
}
```

#### Kimi Code

Add to `~/.kimi-code/mcp.json`. This example pins the Node runtime and the global install path, which avoids both npx startup overhead and ABI mismatches when multiple Node versions are installed:

```json
{
  "mcpServers": {
    "omnimind": {
      "command": "/opt/homebrew/opt/node@20/bin/node",
      "args": ["/opt/homebrew/lib/node_modules/omnimind/dist/mcp-server.js"]
    }
  }
}
```

Adjust both paths to your system (`which node` and `npm root -g` tell you the right values).

#### Any other MCP client

Use the stdio command `npx -y omnimind-mcp` (or `node $(npm root -g)/omnimind/dist/mcp-server.js`) in whatever MCP configuration format your client uses.

**After connecting:** restart the client, then call `omnimind_status` — you should see your namespace, memory counts, and layer distribution. On first start the server backfills memory aging in the background; with a large existing database this can take a minute or two of background CPU.

## HTTP API

Omnimind exposes a local REST API (default port `8844`) used by the desktop GUI and available for external integrations:

```bash
# Start the server manually (if not using the desktop app)
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

Omnimind Explorer is a cross-platform desktop app built with **Tauri v2** and **Svelte 5**. It bundles the Node.js backend, SQLite database, and ONNX model into a single installable package — no separate server setup needed.

```bash
# Development (hot reload) — requires Node.js + Rust
npm run gui:dev

# Production build — produces .dmg / .msi / .deb
npm run gui:build
```

**Features:**
- **Search** — Live hybrid search with filters
- **Timeline** — Chronological memory explorer
- **Concept Graph** — Relationship visualization (D3.js)
- **Stats** — Real-time system health in sidebar

## Development

These commands are for contributors working on the Omnimind codebase.

```bash
# Install dependencies
npm install
cd gui && npm install

# Type-check
npm run typecheck

# Build TypeScript
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

# GUI production build (requires Rust toolchain)
npm run gui:build
```

### Test Coverage

- **226 tests** across 30 test files
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
| **Distribution** | **.dmg (macOS), .msi (Windows), .deb (Linux)** |
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

**Completed (v0.6.8):**
- ✅ Heuristic NER for concept extraction (stoplist + sentence-initial discount + canonicalization), graph noise dampening, `omnimind rebuild-graph`

**Upcoming:**
- ONNX-based NER model (local, `@xenova/transformers`) as optional upgrade
- MCP polish (auto-save hooks)
- P2P encrypted sync
- Team memory spaces

## License

MIT — See [LICENSE](LICENSE)
