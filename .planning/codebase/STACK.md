# Technology Stack

**Analysis Date:** 2026-06-18

## Languages

**Primary:**
- TypeScript 5.5+ (ESM, NodeNext modules) — `package.json`, all of `src/`
- Svelte 5 (TS in `<script lang="ts">`) — `gui/src/**/*.svelte`

**Secondary:**
- Rust 1.75+ (edition 2021) — `src-tauri/Cargo.toml`, `src-tauri/src/main.rs`
- JavaScript (Node scripts) — `scripts/download-model.js`, `scripts/prune-for-bundle.js`
- CSS (Tailwind / PostCSS pipeline) — `gui/postcss.config.js`, `gui/tailwind.config.js`

## Runtime

**Environment:**
- Node.js >= 18.0.0 (`package.json` engines; CI installs Node 22)
- ESM-only: `"type": "module"` in `package.json` and `gui/package.json`
- Targets ES2022 (`tsconfig.json`); GUI targets `esnext` (`gui/vite.config.ts`)
- Bundled Node 20.19.0 inside the Tauri app (`scripts/prepare-resources.sh`)

**Package Manager:**
- npm with `package-lock.json` (root + `gui/package-lock.json` committed; root lockfile excluded from npm publish via `.npmignore`)
- CI uses `npm ci` (`.github/workflows/build-native.yml`)

## Frameworks

**Core (Node side):**
- No application framework — pure TypeScript classes composed in `src/index.ts`
- Node built-in `http` module for the local REST server (`src/server.ts`)
- Node `fs` watchers (`fs.watch`) for cross-tool conversation adapters

**MCP:**
- `@modelcontextprotocol/sdk` ^1.0.0 — `src/mcp/server.ts`, `src/mcp-server.ts`
- Stdio transport only (`StdioServerTransport`)

**Desktop / GUI:**
- Tauri 2 (`src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`) with:
  - `tauri` crate with `tray-icon` feature
  - `tauri-plugin-shell` (allowlist managed in `tauri.conf.json` capabilities: `core:default`, `shell:default`)
- Tauri-sidecar pattern: Rust (`src-tauri/src/main.rs`) spawns a Node.js child process for the backend
- Svelte 5.55+ (`gui/package.json`) + Vite 8 (`gui/vite.config.ts`)
- `@sveltejs/vite-plugin-svelte` 7
- `svelte-check` 4 + `@tsconfig/svelte` 5 for type-checking Svelte components
- Tailwind CSS 3.4 + PostCSS + Autoprefixer (`gui/tailwind.config.js`, `gui/postcss.config.js`)
- `d3` 7.9 + `@types/d3` (graph visualization in `gui/src/lib/components/GraphView.svelte`)
- `@tauri-apps/api` 2.11 in GUI for `invoke` calls (e.g. `get_api_base` in `gui/src/lib/api.ts`)

**Embeddings / ML:**
- `@xenova/transformers` ^2.17.2 — local feature-extraction pipeline (`src/core/EmbeddingEngine.ts`)
- `onnxruntime-node` ^1.18.0 — listed in dependencies; available as an alternative ONNX backend (current `EmbeddingEngine.ts` uses `@xenova/transformers`'s bundled runtime)

**Storage:**
- `better-sqlite3` ^11.0.0 — synchronous SQLite (`src/core/MemoryStore.ts`, `src/core/SearchEngine.ts`, `src/prediction/PatternStore.ts`)
- `sqlite-vss` ^0.1.2 — SQLite Vector Similarity Search extension (loaded conditionally; falls back to brute-force cosine if absent — see `src/core/SearchEngine.ts:43-49`)
- FTS5 virtual table for keyword search (`src/core/MemoryStore.ts:167-`)

**Validation / Schema:**
- `zod` ^3.23.0 — input validation for MCP tools (`src/mcp/server.ts:44-91`)
- `zod-to-json-schema` ^3.25.2 — converts Zod schemas to JSON Schema for MCP `inputSchema`

## Key Dependencies

**Critical (runtime):**
- `@modelcontextprotocol/sdk` ^1.0.0 — MCP protocol (tools, resources, prompts)
- `better-sqlite3` ^11.0.0 — persistence layer
- `sqlite-vss` ^0.1.2 — vector search extension
- `@xenova/transformers` ^2.17.2 — local embeddings (downloads `Xenova/all-MiniLM-L6-v2`, 384-dim)
- `zod` ^3.23.0 — runtime validation

**Encryption (built-in):**
- Node `crypto` module — AES-256-GCM at rest, HKDF-SHA256 key derivation (`src/core/CryptoEngine.ts`)

## Testing

**Runner:**
- Vitest 1.6.0 (`vitest.config.ts`)
- `@vitest/coverage-v8` 1.6 — v8 coverage provider
- Coverage thresholds: lines/functions/statements 80%, branches 70% (`vitest.config.ts:19-24`)

**Patterns:**
- Coverage excludes: `src/cli.ts`, `src/mcp-server.ts`, `src/mcp/server.ts`, `dist/**`, `tests/**`, `**/*.test.ts`, `**/*.config.ts`
- Benchmarks via Vitest benchmark mode (`vitest.config.ts:27-29`)

## Lint / Format

- ESLint 8.57 with `@typescript-eslint` 7.13 (`.eslintrc.cjs`)
- Prettier 3.3 (`format` script)
- `_`-prefixed unused vars/args allowed
- `@typescript-eslint/no-explicit-any` is a warn, not an error
- Lint scope: `src/`, `tests/`

## Build / Dev Tools

- `tsx` 4.15 — dev runtime (no separate ts-node)
- `tsc` 5.5 — production build (`npm run build`)
- Tauri 2 CLI (`@tauri-apps/cli` 2.10) for desktop bundling
- Scripts:
  - `dev` — `tsx watch src/index.ts`
  - `server:dev` — `tsx watch src/server.ts`
  - `gui:dev` — `tauri dev` (runs Vite + Rust)
  - `gui:build` — `tauri build`
  - `postinstall` — `node scripts/download-model.js` (pre-downloads embedding model)
  - `prepublishOnly` — `npm run build && cd gui && npm run build`

## Configuration

**Environment:**
- No `.env` files committed (`.gitignore` excludes them)
- No required env vars at runtime
- Optional env vars (see `src/server.ts:48-55`, `src/mcp/server.ts:412-413`, `src-tauri/src/main.rs:101-106`):
  - `OMNIMIND_PORT` — HTTP server port (default 8844)
  - `OMNIMIND_DATA_DIR` — SQLite directory
  - `OMNIMIND_SKIP_ADAPTERS=1` — disable filesystem-watcher adapters (set by Tauri sidecar)
  - `TRANSFORMERS_CACHE` — HuggingFace cache dir (set by Tauri to `resource_dir/.cache`)
  - `GIT_BRANCH`, `CURRENT_FILE` — optional context hints for predictions

**Build configs:**
- `tsconfig.json` (root) — strict ESM NodeNext, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- `gui/tsconfig.app.json` — Svelte + Vite client
- `gui/tsconfig.node.json` — Vite config
- `vitest.config.ts` — Node env, v8 coverage, 30s test timeout
- `.eslintrc.cjs` — root-level TS ESLint config
- `src-tauri/tauri.conf.json` — product `Omnimind Explorer`, identifier `com.omnimind.app`, window 1280×800
- `src-tauri/Cargo.toml` — rust-version 1.75, edition 2021, deps `tauri 2`, `tauri-plugin-shell 2`, `serde 1`, `serde_json 1`

## Platform Requirements

**Development:**
- macOS / Linux / Windows
- Node >= 18 (CI uses 22)
- Rust stable + target triples per platform (`aarch64-apple-darwin`, `x86_64-apple-darwin`, `x86_64-unknown-linux-gnu`, `x86_64-pc-windows-msvc`)
- Linux build also needs `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`

**Production / Distribution:**
- Tauri 2 native bundles: `app`, `dmg`, `msi`, `appimage`, `deb` (`src-tauri/tauri.conf.json:46`)
- Self-contained: bundles its own Node 20.19.0 binary + compiled TS dist + `@xenova/transformers/.cache` model into `src-tauri/resources/`
- npm package distributes `dist/` + `gui/dist/` + `scripts/` (`package.json` `files` array)

---

*Stack analysis: 2026-06-18*