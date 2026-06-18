# External Integrations

**Analysis Date:** 2026-06-18

## Design Stance

Omnimind is intentionally **100% local / privacy-first**. After install, the only outbound network call is a once-per-day check against the GitHub Releases API from the desktop GUI for update notifications. All embedding, search, encryption, and storage run on-device. No cloud databases, no LLM API calls, no telemetry.

## APIs & External Services

**None — direct API calls:**
- No remote LLM providers (no OpenAI / Anthropic SDK in `package.json`)
- No analytics, no error tracking, no remote logging
- No third-party SaaS

**HuggingFace / Xenova (model download, one-time):**
- The `Xenova/all-MiniLM-L6-v2` ONNX model is downloaded at `npm install` time via `scripts/download-model.js` (and again at first run if cache is empty)
- Pipeline initialized in `src/core/EmbeddingEngine.ts:62` via `pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')`
- Cache path controlled by `TRANSFORMERS_CACHE` env var; Tauri sets it to `<resource_dir>/.cache`
- 384-dim embeddings, max sequence length 256

**GitHub Releases API (update checker):**
- `gui/src/lib/updates.ts:13` — `https://api.github.com/repos/fedec65/omnimind/releases/latest`
- Throttled to once per day via `localStorage` (`STORAGE_KEY_LAST_CHECK`)
- User can dismiss a version (`STORAGE_KEY_SKIP_VERSION`)
- `Accept: application/vnd.github+json` header
- No auth — public endpoint

## Data Storage

**Database:**
- SQLite via `better-sqlite3` 11 — local file at `~/.omnimind/memory.db` by default (`src/mcp/server.ts:103`, `src/index.ts` data-dir resolution)
- Tauri overrides path via `OMNIMIND_DATA_DIR` → `app_data_dir()`
- Schema includes:
  - `memories` table with `embedding BLOB` (Float32Array buffer for 384-dim vectors)
  - FTS5 virtual table for keyword search (`src/core/MemoryStore.ts:167`)
  - `entities`, `relations`, `wisdom_patterns`, `archive`, `patterns` (knowledge graph + aging + bus)
- `sqlite-vss` 0.1.2 vector extension loaded conditionally — falls back to brute-force cosine if absent (`src/core/SearchEngine.ts:43-49`)

**Vector Search:**
- `sqlite-vss` for ANN search when available
- Pure-JS brute-force cosine fallback when extension is missing
- Hybrid scoring: FTS5 rank + vector cosine, fused in `MemoryStore`

**File Storage:**
- SQLite only — no separate blob/attachment store
- Model files cached at `node_modules/@xenova/transformers/.cache` (or `TRANSFORMERS_CACHE`)
- Watchers observe conversation files in-place, no copy

**Caching:**
- HuggingFace model cache (see above)
- No Redis / Memcached / external cache

## Authentication & Identity

**Auth Provider:** None
- No user accounts, no OAuth, no tokens
- Optional local passphrase for AES-256-GCM key derivation via HKDF (`src/core/CryptoEngine.ts:11`)
- Machine fingerprint derived from `hostname()` + `userInfo().username` if no passphrase supplied

**MCP clients (no auth, but trusted launchers):**
- Claude Code — user adds `"omnimind-mcp"` to `~/.claude/settings.json` (`README.md:184-195`)
- Cursor — same pattern
- ChatGPT — no first-class MCP support; integration via filesystem export watcher only
- Claude Desktop — same, plus Omnimind's own Tauri app

## Monitoring & Observability

**Error Tracking:** None
- All errors logged to stderr/stdout
- `MCP server` writes to `console.error` (`src/mcp/server.ts:159, 169`)
- HTTP server writes to `console.log`/`console.error` (`src/server.ts:71-83`)
- Adapters log reconnection attempts to console (`src/bus/adapters/BaseAdapter.ts:77`)

**Logs:**
- stdout/stderr only — no log files, no log shipping
- Format: `[Component] message`

## CI/CD & Deployment

**Hosting:**
- npm registry (`omnimind` package, current version 0.6.5)
- GitHub Releases (`.github/workflows/build-native.yml`) — Tauri-native bundles for macOS (aarch64 + x86_64), Linux (deb/AppImage), Windows (msi)

**CI Pipeline:**
- GitHub Actions only (single workflow: `build-native.yml`)
- Triggers: tag push matching `v*`, or `workflow_dispatch`
- Matrix: 4 targets (macOS-arm64, macOS-x64, ubuntu-22.04, windows-latest)
- Pipeline:
  1. checkout
  2. setup Node 22 + Rust stable + target triple
  3. Ubuntu apt deps (`libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`)
  4. `npm ci` (root + `gui/`)
  5. `node scripts/download-model.js`
  6. `npm run build`
  7. `bash scripts/prepare-resources.sh <platform>` (downloads Node binary, copies dist, model cache)
  8. `tauri-apps/tauri-action@v0` builds + publishes to GitHub Release

**No telemetry, no Sentry, no Datadog, no New Relic.**

## Environment Configuration

**Required env vars:** None
**Optional env vars:**
- `OMNIMIND_PORT` — HTTP server port, default 8844 (`src/server.ts:48`)
- `OMNIMIND_DATA_DIR` — SQLite directory (`src/server.ts:49`)
- `OMNIMIND_SKIP_ADAPTERS=1` — disable filesystem-watcher adapters (Tauri sidecar sets this — `src-tauri/src/main.rs:105,135`)
- `TRANSFORMERS_CACHE` — HuggingFace model cache dir (Tauri sets to `<resource_dir>/.cache`)
- `GIT_BRANCH`, `CURRENT_FILE` — optional prediction context (`src/mcp/server.ts:412-413`)

**Secrets location:**
- No secrets stored anywhere
- No API keys needed
- Encryption passphrase (optional) supplied via `OmnimindConfig` at runtime, not from env
- `~/.claude/settings.json` is the user's Claude Code MCP config, not Omnimind's

## File-System Integrations (Adapters)

Omnimind reads from local filesystem locations via the cross-tool `MemoryBus` (`src/bus/adapters/`):

**Claude Code Adapter** (`src/bus/adapters/ClaudeAdapter.ts`):
- Watches: `~/.claude/projects/` (recursive, default)
- Format: `.jsonl` conversation files
- Also writes notifications to `CLAUDE.md`
- Checkpoint: `.omnimind-claude-checkpoint.json`
- Decision-pattern extraction: regex on user/assistant messages

**Claude Desktop Adapter** (`src/bus/adapters/ClaudeDesktopAdapter.ts`):
- Watches: `~/Library/Application Support/Claude/claude-code-sessions/` (macOS default; no-ops on non-darwin unless explicit path)
- Format: `local_*.json` session metadata (title, cwd, model, worktreePath — **not** conversation content)
- Checkpoint: `.omnimind-claude-desktop-checkpoint.json`

**Cursor Adapter** (`src/bus/adapters/CursorAdapter.ts`):
- Watches: `~/.cursor/conversations/` (recursive, default)
- Formats: `.jsonl` (line-delimited `{role, content}`) or `.json` (array of messages)
- Cursor has no native local conversation export, so users configure a watched directory
- Checkpoint: `.omnimind-cursor-checkpoint.json`

**ChatGPT Adapter** (`src/bus/adapters/ChatGPTAdapter.ts`):
- Watches a configurable directory for ChatGPT JSON exports
- Format: OpenAI export schema — `conversations[].mapping[uuid].message.{author.role, content.parts}`
- One-shot import (not a stream)
- Checkpoint: `.omnimind-chatgpt-checkpoint.json`

All adapters extend `BaseAdapter` (`src/bus/adapters/BaseAdapter.ts`) — heartbeat every 30s, exponential reconnect backoff (cap 30s), vector-clock event ordering.

## Webhooks & Callbacks

**Incoming:** None
- HTTP server (`src/server.ts`) is bound to localhost only (Tauri sets `127.0.0.1`)
- No public webhooks, no ingress endpoints

**Outgoing:** None
- No outbound HTTP from the Node backend at runtime
- Only `gui/src/lib/updates.ts` makes an outbound call, and it goes only to `api.github.com`

## Local IPC (Tauri ↔ Node sidecar)

- Tauri Rust binary (`src-tauri/src/main.rs`) spawns Node.js server as a child process
- Port discovery: Rust binds to `127.0.0.1:0` to find a free port (`find_available_port()`), passes it via `OMNIMIND_PORT` env, then `Omnimind Server` listens and Rust invokes it via HTTP
- One Tauri command exposed: `get_api_base` (`src-tauri/src/main.rs:17`) — returns `http://127.0.0.1:<port>` to the Svelte frontend
- Frontend calls the local HTTP REST API at the discovered base URL (`gui/src/lib/api.ts:23`)
- Node process killed on window destroy (`on_window_event` handler)

## Local REST API (intra-machine)

`src/server.ts` exposes (default port 8844; Tauri uses its own dynamic port):

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Health/version check |
| `/api/memories` | GET/POST | List/create memories |
| `/api/memories/:id` | GET/PUT/DELETE | Memory CRUD |
| `/api/search` | GET | Search with `q`, `limit`, `namespace`, `timeRange` |
| `/api/predictions` | GET | Predict for current context |
| `/api/stats` | GET | Aggregated store/bus/predictor stats |
| `/api/entities` / `/api/relations` / `/api/graph` | GET | Knowledge graph |
| `/api/settings` | GET/POST | Settings K/V |
| `/api/bus/status` / `/api/bus/conflicts` / `/api/bus/sync` | GET/POST | Bus state |
| `/api/context` | GET | Context injection payload |
| `/api/import` / `/api/export` | POST/GET | JSON backup |
| `/api/age` / `/api/evict` | POST | Aging operations |
| `/api/archive` + `/api/archive/search` + `/api/archive/restore*` | GET/POST | Archive CRUD |
| `/api/wisdom` / `/api/wisdom/aggregate` | GET/POST | Wisdom patterns |

CORS headers allow all origins (`Access-Control-Allow-Origin: *`) because the only consumer is the bundled Tauri frontend on `localhost`.

## MCP Surface (for AI tool clients)

Exposed via `src/mcp/server.ts` on **stdio transport**:

**Tools:** `omnimind_search`, `omnimind_store`, `omnimind_store_conversation`, `omnimind_predict`, `omnimind_status`, `omnimind_subscribe`, `omnimind_sync`
**Resources:** `omnimind://context/predictions`, `omnimind://stats/overview`
**Prompts:** `memory-aware`
**Connection:** Each MCP client (Claude Code, Cursor, etc.) launches `npx omnimind-mcp` as a subprocess; the Node process holds the SQLite DB file exclusively per client (no shared state across concurrent MCP launches — coordination is via the HTTP API and filesystem adapters instead).

---

*Integration audit: 2026-06-18*