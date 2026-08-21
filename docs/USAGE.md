# Using Omnimind

A practical guide to storing, searching, and organizing memories — via AI agents, the desktop app, the CLI, and the HTTP API.

> **Where memories live:** everything is stored locally in `~/.omnimind/` (SQLite + local embeddings, encrypted at rest). The desktop app, the MCP server, and the CLI all share this single database. Override with the `OMNIMIND_DATA_DIR` environment variable.

---

## 1. The mental model

Every memory has:

| Field | Purpose |
|-------|---------|
| `content` | The text of the memory |
| `wing` | Top-level category (e.g. a project, a client, `preferences`) |
| `room` | Sub-category inside the wing (e.g. `architecture`, `deadlines`) |
| `pinned` | If true, the memory never ages or degrades |
| `layer` | Aging layer: L0 Verbatim → L1 Compressed → L2 Concept → L3 Wisdom |

**Recommended organization:** `wing` = project/client, `room` = topic. This makes every future search far more precise.

```
wing: "project-alpha"     room: "architecture" | "decisions" | "bugs"
wing: "client-rossi"      room: "contract" | "correspondence" | "hearings"
wing: "preferences"       room: "style" | "tools" | "workflow"
```

---

## 2. Using AI agents (the natural way)

If Omnimind is connected as an MCP server (see [README](../README.md#setting-up-mcp-clients)), just talk to your agent — it translates your intent into memory operations.

### Storing

> "Remember that the client Rossi prefers to be contacted by email"
> "Save this decision in wing project-alpha, room architecture: we use GraphQL over REST"

The agent calls `omnimind_store`. Give explicit wing/room when it matters, otherwise the agent infers them from context.

### Searching

> "What did we decide about the penalty clause with Rossi?"
> "What was the ABI mismatch fix from last week?"

The agent calls `omnimind_search` and answers from the results.

### Useful agent commands

- "Show memory status" → `omnimind_status` (counts, layers, bus stats)
- "Pin that memory" → prevents aging for critical facts (deadlines, decisions)
- "What do you predict I need now?" → `omnimind_predict`

---

## 3. Using the desktop app (Omnimind Explorer)

| View | What it does |
|------|--------------|
| **Search** | Live hybrid search (semantic + keyword + graph), with wing/room/layer filters |
| **Timeline** | Chronological memory browser |
| **Concept Graph** | Entity-relation graph extracted from memories (coherent sample of 500 entities) |
| **Stats** | System health in the sidebar |

Everything you do in the GUI — searching, reading, creating memories — also feeds the prediction engine (from v0.6.8 onward).

**Settings → Connect AI Tools** (v0.7.3+): register the Omnimind MCP server in Claude Code, Cursor, Claude Desktop, and Kimi Code with one click — the registration points at the app's bundled backend, so no npm install is required. The same panel can install the `omnimind` shell command (`/usr/local/bin` or `~/.local/bin`).

---

## 4. Using the CLI

```bash
# Store
omnimind store "Rossi prefers email over phone" --wing client-rossi --room preferences
omnimind store "Hearing set for March 14" --wing case-2026-041 --pin

# Search
omnimind search "Rossi contact preferences"
omnimind search "penalty clause" --wing client-rossi --limit 5

# Inspect
omnimind status          # totals, layers, DB size, predictor patterns
omnimind predict         # memories predicted for the current context

# Maintenance
omnimind rebuild-graph --yes   # wipe and re-derive the concept graph
                               # (needed after NER/extractor upgrades)
omnimind wipe --yes-i-am-sure  # delete ALL memories (irreversible)
```

First run downloads the ~80 MB ONNX embedding model once; everything after that is fully offline.

---

## 5. Using the HTTP API

The local REST API (default port `8844`, started by the desktop app or `npm run server`):

```bash
# Store
curl -X POST localhost:8844/api/memories \
  -H 'Content-Type: application/json' \
  -d '{"content": "Rossi prefers email", "wing": "client-rossi", "room": "preferences"}'

# Search
curl "localhost:8844/api/search?q=penalty+clause&limit=5"

# List with filters
curl "localhost:8844/api/memories?q=rossi&wing=client-rossi&limit=10"

# Health / stats
curl localhost:8844/api/health
curl localhost:8844/api/stats
```

Full endpoint list: [README — HTTP API](../README.md#http-api).

---

## 6. Pinning and aging

Memories age automatically (lazy, on access + a startup backfill):

| Layer | Age | What happens |
|-------|-----|--------------|
| L0 Verbatim | 0–7 days | Full text |
| L1 Compressed | 7–30 days | Shorthand compression |
| L2 Concept | 30–180 days | Entities/relations extracted into the graph |
| L3 Wisdom | 180+ days | Distilled patterns |

**Pin anything that must never degrade** — deadlines, court decisions, key client preferences. Pinned memories stay verbatim forever.

The original content is always backed up to the `memory_versions` table before an aging transition, so graph rebuilds are lossless.

---

## 7. Predictions

Omnimind learns which memories you use in which context (project, branch, file type, time of day) and proactively suggests them once confidence reaches 50%. Predictions appear:

- in the GUI **Predictions** panel,
- via `omnimind predict` (CLI) or `omnimind_predict` (MCP),
- injected as `<omnimind_predictions>` blocks for MCP clients that use the `memory-aware` prompt.

Patterns build up automatically as you search and store — no training step needed.

---

## 8. Multi-language notes

The concept extractor works in two engines, both 100% local:

- **Heuristic (default)** — zero-download rule-based extractor. Auto-detects English, Italian, French, German, Spanish, and Portuguese per memory (function-word voting) and applies the matching language pack. Mixed-language texts use a merged pack. Non-Latin scripts degrade gracefully (quoted-string extraction only).
- **ONNX model (opt-in)** — a multilingual NER model (`bert-base-multilingual-cased-ner-hrl`, ~178MB, downloaded once on first use) covering 10 languages: Arabic, German, English, Spanish, French, Italian, Dutch, Polish, Portuguese, Russian, and Chinese. It recognizes people, organizations, and locations with much higher recall than the heuristic.

### Enabling the ONNX NER engine

```bash
# One-off: rebuild the graph with the ONNX engine (also persists the choice)
omnimind rebuild-graph --ner onnx --yes

# Pre-download the model at install time
OMNIMIND_NER=onnx npm install
```

The choice is stored in the `nerEngine` setting, so the HTTP server, the MCP server, and the GUI pick it up on their next start. Check which engine is active with `omnimind status` (CLI) or `omnimind_status` (MCP). If the model cannot be loaded (offline first run, not enough memory), Omnimind automatically falls back to the heuristic — extraction never breaks.

Both engines produce the same canonical entity ids (`entity_<normalized name>`), so the knowledge graph merges entities regardless of which engine extracted them.

---

## 9. Backup, export, privacy

- **Backup:** copy `~/.omnimind/` (safe when no server is running), or use `GET /api/export` for a JSON snapshot.
- **Import:** `POST /api/import` with a previously exported JSON.
- **Privacy:** memories never leave your machine and are not in the git repository. The DB is encrypted at rest (machine-bound key by default; optional passphrase for portability across machines).
- **Deleting everything:** `omnimind wipe --yes-i-am-sure`.
