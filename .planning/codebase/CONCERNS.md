# Codebase Concerns

**Analysis Date:** 2026-06-18

## Tech Debt

**Encryption write-only — never reads back:**
- Issue: `MemoryStore.ts:354-357` and `MemoryStore.ts:483-489` encrypt content on `store()` / `storeTurns()` when `this.crypto` is set, but `rowToMemory()` at `MemoryStore.ts:1696-1719` and `restoreFromArchive()` at `MemoryStore.ts:1162-1182` return the raw row content without decrypting. Even worse, `restoreFromArchive` (around `MemoryStore.ts:1198-1206`) re-inserts the encrypted blob back into the active table without decryption, so encryption is currently one-way and will return JSON-encoded ciphertext to consumers.
- Files: `src/core/MemoryStore.ts`
- Impact: Any consumer enabling `encryption` config will receive opaque JSON blobs and embedding queries over ciphertext (FTS5 trigger at `src/core/MemoryStore.ts:178-194` will index the encrypted blob text, breaking keyword search). Export (`exportMemories` at line 763) and archive restore will leak ciphertext.
- Fix approach: Either remove the encrypt-on-write path entirely (never wired into `init()` — see `MemoryStore.init` at line 253-300, `this.crypto` stays null), or wire `this.crypto` in `init()` from `config.encryption`, and decrypt in `rowToMemory()` whenever the stored content is JSON-wrapped ciphertext. Also re-index FTS5 on decrypt.

**`ActivityTracker` monkey-patches `bus.publish`:**
- Issue: `ActivityTracker.start()` at `src/prediction/ActivityTracker.ts:118-127` overwrites `this.bus.publish` with a wrapper. If `start()` is called twice (current guard returns early at line 99, OK), or if a second tracker is added later, only one will receive events. The wrapper also runs on every publish — including access events that the tracker itself re-emits — risking feedback loops. The `busUnsubscribe` saves the previous reference, so reordering of `stop()` and adapter shutdowns can leak the patched version.
- Files: `src/prediction/ActivityTracker.ts`, `src/bus/MemoryBus.ts`
- Impact: Hard-to-debug prediction drift, double-counting in `recordAccess`, and risk of an adapter override persisting after `stop()` if the original reference is captured incorrectly.
- Fix approach: Add a real `subscribe('activity-tracker', { eventTypes: [...] })` listener API on `MemoryBus` (subscribers already exist in `MemoryBus.subscribe` at line 123, but no fire path — see below) and have `ActivityTracker` consume events through that channel.

**Empty event listener API on `MemoryBus`:**
- Issue: `MemoryBus.subscribe()` at `src/bus/MemoryBus.ts:123-130` stores filters, but nothing in the routing code (`MemoryBus.route` at line 263) actually invokes subscribers on `publish`. Only adapter `onMemoryEvent` callbacks fire. So `ActivityTracker` cannot receive events through subscription and was forced into monkey-patching.
- Files: `src/bus/MemoryBus.ts`, `src/prediction/ActivityTracker.ts`
- Impact: Architectural debt that justifies the monkey-patch workaround. Any other consumer that needs to observe bus events will be tempted to repeat the same hack.
- Fix approach: In `route()`, iterate `this.subscriptions` and dispatch each `filter`-matching event to a new `onEvent(event)` hook added to a `BusSubscriber` interface; have `ActivityTracker` implement that interface.

**`MemoryBus.sync()` is a no-op:**
- Issue: `MemoryBus.sync()` at `src/bus/MemoryBus.ts:138-148` logs and returns `[]`. ROADMAP Phase 3 (Cross-Device Sync Protocol) is marked `IN PROGRESS`, and the MCP tool `omnimind_sync` (`src/mcp/server.ts:609-636`) advertises a real sync, so MCP clients will call it expecting results.
- Files: `src/bus/MemoryBus.ts:138-148`, `src/mcp/server.ts:207-211, 609-636`
- Impact: Clients that depend on sync (Claude Desktop, Cursor) will silently miss events. Misleading API surface.
- Fix approach: Either persist events to an `event_log` table and replay on sync, or return `err()` with a clear "not implemented" until Phase 3 ships. Either way update the MCP description and remove the false promise.

**Cross-device P2P sync advertised as Phase 3 deliverable but not started:**
- Issue: ROADMAP.md Phase 3 "Remaining" lists "Cross-device sync protocol (encrypted P2P)" — no code exists. Memory merge strategies UI is also marked done in ROADMAP.md but no GUI code under `gui/` is referenced in the roadmap's "Delivered" for Phase 4.
- Files: `ROADMAP.md`, missing entirely
- Impact: External readers and prospective users see a roadmap that overstates delivery; testing expectations diverge from reality.
- Fix approach: Audit the gui code paths and correct ROADMAP.md checkboxes.

**`AgingScheduler.runAgingCheck()` is empty:**
- Issue: `src/layers/AgingPipeline.ts:358-362` logs and returns. `bulkAge()` in `src/index.ts:460-485` performs the work, but the scheduler (line 342-355) never invokes it.
- Files: `src/layers/AgingPipeline.ts`
- Impact: Time-driven aging depends on memory access patterns (lazy), which means low-traffic memories may never age; the 90-day `autoEvictDays` startup eviction in `src/index.ts:191-201` is the only actual safety net.
- Fix approach: Implement the scheduler body using `MemoryStore.getAllMemoryIds()` and `Omnimind.checkAging()`.

**`MemoryBus.detectConflict` builds a synthetic event via string parsing rather than comparing clocks directly:**
- Issue: `MemoryBus.detectConflict` at `src/bus/MemoryBus.ts:204-231` constructs a fake `MemoryEvent` from the stored memory, then hands it to `ConflictResolver.resolve` (`src/bus/ConflictResolver.ts:31-83`), which compares vector clocks. But the synthetic event's `vectorClock` is empty (`{}`), so the comparison collapses to one of the special cases (priority tiebreak or timestamp) rather than using the actual stored clock. Vector-clock logic in `ConflictResolver` is effectively dead.
- Files: `src/bus/MemoryBus.ts`, `src/bus/ConflictResolver.ts`
- Impact: Cross-tool conflicts are decided by priority order alone; the entire vector-clock subsystem is never exercised. Worse, both events typically have empty clocks so concurrent edits with equal priority become `manual_review` (acceptable) but never hit the "before/after" path.
- Fix approach: Store vector clock state alongside each memory in `memories` table (or in the `event_log` table when introduced), then pass the real clock to `ConflictResolver.resolve`.

## Known Bugs

**`retrievalLatencies` grows unbounded during search:**
- Symptoms: `MemoryStore.search()` at `src/core/MemoryStore.ts:749-752` pushes latency then `if (length > 100) shift()` — bounded, OK. However `getStats()` at `src/core/MemoryStore.ts:921` reads `this.retrievalLatencies` but the file line 949 onward (avg) only runs when `this.retrievalLatencies.length > 0`; not a bug but worth verifying the stats aggregation isn't computed on the full 100-entry window.
- Files: `src/core/MemoryStore.ts:749-757`
- Trigger: Every `search()` call.
- Workaround: None needed today; monitor.

**`compressToL1` fallback to truncation may truncate irreversibly:**
- Symptoms: `AgingPipeline.compressToL1()` at `src/layers/AgingPipeline.ts:175-178` falls back to `content.substring(0, targetLength) + ' [...]'` when regex rules don't reduce size. After aging, the L0 original is kept as `compressedRef` only by id, not by content (no content backup is stored anywhere).
- Files: `src/layers/AgingPipeline.ts`
- Trigger: Any memory > 500 chars that doesn't compress meaningfully.
- Workaround: Pin L0 memories with `pin()` to prevent aging.

**Search ranking: `matchType: 'graph'` boost collides with fusion scores:**
- Symptoms: `MemoryStore.search()` at `src/core/MemoryStore.ts:728` applies `r.score * 1.1` only to graph matches that did not also appear in vector/keyword results (because they are appended after `fuseResults`). A graph match with a high score (1.0) will outrank a vector/keyword match with raw score 0.95 because the boost is multiplicative on a higher base.
- Files: `src/core/MemoryStore.ts:718-731`
- Trigger: Searches where graph matches co-occur with strong vector matches.
- Workaround: None.

**FTS5 index references ciphertext if encryption is ever enabled:**
- Symptoms: If `crypto` were ever wired in, FTS5 trigger at `src/core/MemoryStore.ts:178-194` would index the encrypted JSON blob, breaking keyword search. Currently dormant.
- Files: `src/core/MemoryStore.ts:178-194`
- Trigger: When (if) `crypto` initialization is added.
- Workaround: Do not enable encryption until write+read paths are aligned.

**`ActivityTracker` debounce timer never fires after `stop()`:**
- Symptoms: `ActivityTracker.stop()` at `src/prediction/ActivityTracker.ts:144-149` clears the timer, but the watcher callback at line 220-227 may have already scheduled one. Race-free in single-threaded JS, but the file-change window (`this.window.files`) is never persisted, so context fingerprints reset on every restart.
- Files: `src/prediction/ActivityTracker.ts`
- Trigger: Restart with active file edits.
- Workaround: None.

**`ConflictResolver.compareVectorClocks` cannot detect concurrent edits from identical clocks:**
- Symptoms: `compareVectorClocks` at `src/bus/ConflictResolver.ts:172-193` returns `'equal'` when both clocks are empty `{}` (zero iteration, no `aGreater`/`bGreater` set). This is the common case in the current pipeline; falls through to priority+timestamp tiebreak.
- Files: `src/bus/ConflictResolver.ts`
- Trigger: Most real conflicts today.
- Workaround: None; behavior is acceptable but the vector-clock abstraction is misleading.

## Security Considerations

**No authentication on `src/server.ts` HTTP API:**
- Risk: `src/server.ts` binds to `localhost:8844` (line 48) and sets `Access-Control-Allow-Origin: *` (line 60), `Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS` (line 61). Any local process or browser script can read/write/delete memories and trigger aging/eviction via `POST /api/evict`, `POST /api/age`, `DELETE /api/memories/:id`. No API key, no CSRF token, no origin check.
- Files: `src/server.ts`
- Current mitigation: Loopback binding only.
- Recommendations: Bind explicitly to `127.0.0.1` (not all interfaces — current code does not, Node defaults to `0.0.0.0` if no host arg given; line 76 uses `server.listen(PORT)` with no host); restrict CORS to Tauri origin; require a bearer token from the Tauri parent process at startup (Tauri already IPCs via `process.send` at line 82-84, extend that handshake).

**`ClaudeAdapter.onMemoryEvent` writes to `process.cwd()/CLAUDE.md`:**
- Risk: `src/bus/adapters/ClaudeAdapter.ts:121-137` appends `<!-- Omnimind update from ... -->` HTML comments to whatever `CLAUDE.md` exists in the current working directory. This can be silently modified by any cross-tool event routed back to this adapter.
- Files: `src/bus/adapters/ClaudeAdapter.ts:121-137`
- Current mitigation: Only writes when `CLAUDE.md` exists.
- Recommendations: Gate behind explicit opt-in (config flag), restrict to project roots registered in a config file, and append to a dedicated `~/.omnimind/notifications.md` instead.

**`Machine fingerprint` for crypto is weak:**
- Risk: `getMachineFingerprint()` at `src/core/CryptoEngine.ts:103-108` combines hostname, username, and arch — all guessable / discoverable from any process on the host. As noted in the comment at line 105, "This is not cryptographically secure but provides stability across restarts."
- Files: `src/core/CryptoEngine.ts`
- Current mitigation: None beyond OS user separation.
- Recommendations: If encryption is wired in, require a passphrase from the user or use a hardware-bound key (TPM/Secure Enclave); never use machine fingerprint alone.

**Tauri `csp: null`:**
- Risk: `src-tauri/tauri.conf.json:29` sets `"csp": null`, allowing any origin to load resources in the WebView. The Svelte frontend makes fetch calls to the localhost HTTP API, but with CSP disabled, an XSS in any loaded asset can reach `localhost:8844`.
- Files: `src-tauri/tauri.conf.json`
- Current mitigation: `withGlobalTauri: true` (line 13) and limited `capabilities` (`core:default`, `shell:default`, line 36-40) are the only boundaries.
- Recommendations: Add a strict CSP such as `"default-src 'self'; connect-src 'self' http://127.0.0.1:8844"`.

**Tauri shell plugin enabled with default permissions:**
- Risk: `src-tauri/src/main.rs:23` enables `tauri_plugin_shell::init()` and `tauri.conf.json:38` grants `shell:default`. If the Svelte frontend is ever compromised, it can spawn arbitrary commands.
- Files: `src-tauri/src/main.rs`, `src-tauri/tauri.conf.json`
- Current mitigation: Only used by Rust `main.rs` for the Node sidecar spawn.
- Recommendations: Remove the shell plugin (Node sidecar is spawned by Rust directly) or restrict to a hard-coded list of allowed commands.

**Cross-tool adapter writes checkpoint and CLAUDE.md in user home:**
- Risk: `ClaudeAdapter.checkpointPath` (`src/bus/adapters/ClaudeAdapter.ts:68`) and equivalents in `CursorAdapter.ts:57`, `ChatGPTAdapter.ts:89`, `ClaudeDesktopAdapter.ts:78` write JSON files inside the watched directory. If that directory is shared (e.g., network mount or git repo), checkpoint data leaks.
- Files: all four adapters
- Current mitigation: Hidden filename (starts with `.omnimind-`).
- Recommendations: Store checkpoints in `~/.omnimind/checkpoints/` instead.

**Adapters execute on file changes from any process:**
- Risk: `fs.watch` in all four adapters (`ClaudeAdapter.ts:82-90`, `CursorAdapter.ts:70-78`, `ChatGPTAdapter.ts:102-110`, `ClaudeDesktopAdapter.ts:98-110`) is unrestricted. Any local process can drop a `.jsonl` file into `~/.claude/projects` and have it auto-imported into memory.
- Files: all four adapters
- Current mitigation: Hash-based dedup helps only against identical replays.
- Recommendations: Add a config flag to disable auto-import; validate expected parent directory ownership before parsing.

**Adapter bulk-import on startup (`processExistingOnConnect: true`):**
- Risk: `src/index.ts:151, 169` and `src/mcp/server.ts:134, 152` register Claude and Claude Desktop adapters with `processExistingOnConnect: true`. On first startup, this re-reads every `.jsonl` from `~/.claude/projects`, hashes them, and stores unique turns. Pastes of foreign conversations placed in that directory by another tool become "memories".
- Files: `src/index.ts:151, 169`, `src/mcp/server.ts:134, 152`
- Current mitigation: Hash dedup; namespace is per-tool id.
- Recommendations: Default `processExistingOnConnect` to `false` for the public npm package; require explicit opt-in.

## Performance Bottlenecks

**`SearchEngine.graphSearch` uses `LIKE '%query%'` and `LIKE '%"id"%'`:**
- Problem: `src/core/SearchEngine.ts:121-155` performs two unindexed `LIKE` queries per call. With many memories, this is O(N) and blocks the search latency budget (<20ms target from `BENCHMARKS.md:14`).
- Files: `src/core/SearchEngine.ts:121-155`
- Cause: No index on `entities.name` (none in `INIT_SQL` at `src/core/MemoryStore.ts:147-148`), and the `concept_refs` JSON column at `src/core/MemoryStore.ts:59` is not indexed either.
- Improvement path: Add FTS5 on entity names, or build a normalized `memory_entities` join table with `idx(memory_id, entity_id)`.

**`MemoryStore.getAllMemoryIds()` loads all IDs into memory:**
- Problem: `src/core/MemoryStore.ts:568-576` returns full id list. Called by `Omnimind.bulkAge()` at `src/index.ts:460-485` in a loop with N `get()` calls.
- Files: `src/core/MemoryStore.ts`, `src/index.ts:460-485`
- Cause: No streaming or batching interface.
- Improvement path: Page through ids or use a single SQL `UPDATE` for bulk aging.

**`logActivity` writes synchronously on every memory op:**
- Problem: `src/core/MemoryStore.ts:1835-1848` runs `INSERT INTO activity_log` on every `store`, `search`, and other operations. With high-throughput prediction-triggered stores, this adds an extra fsync per op.
- Files: `src/core/MemoryStore.ts:387, 544, 746`
- Cause: No batching or async flush.
- Improvement path: Buffer activity events and flush every N ops or on idle.

**Auto-eviction on startup scans the full table:**
- Problem: `src/index.ts:191-201` calls `store.evictStaleMemories({ maxAgeDays })` with default 90 days and `limit: 1000` (`MemoryStore.ts:982`). If the DB has grown, only 1000 are evicted per startup; nothing reschedules the next batch.
- Files: `src/index.ts:191-201`, `src/core/MemoryStore.ts:969-1040`
- Cause: Hard cap `limit: 1000`.
- Improvement path: Loop until `count < limit`, or expose a background scheduler.

**`@xenova/transformers` model load is ~80 MB and synchronous on first run:**
- Problem: `scripts/download-model.js:14-22` triggers download via `pipeline()`; `EmbeddingEngine.init()` at `src/core/EmbeddingEngine.ts:60-69` does the same. Model is ~80 MB (`BENCHMARKS.md:8`), and the postinstall script does not parallelize with the rest of `npm install`.
- Files: `scripts/download-model.js`, `src/core/EmbeddingEngine.ts:60-69`
- Cause: Single-threaded download; no streaming.
- Improvement path: Use `--prefer-offline` cache check first; if not cached, surface progress.

## Fragile Areas

**`MemoryStore.evictStaleMemories` deletes vector twice:**
- Files: `src/core/MemoryStore.ts:1000-1003` (outside transaction) and again at lines 1031-1034 (after transaction). Idempotent but confusing. The earlier loop runs before the archive+delete transaction commits; if the transaction rolls back, the vector index is left inconsistent with the table.
- Why fragile: Order of operations is sensitive; readers may rely on vector index freshness.
- Safe modification: Delete vector only after the transaction commits; wrap each deleteVector in a try/catch and log.
- Test coverage: `tests/core/MemoryStore.test.ts` exists but eviction-specific path unclear.

**`rowToMemory` constructs `Float32Array` with `byteOffset` slicing that depends on alignment:**
- Files: `src/core/MemoryStore.ts:1701-1702` and `1166, 1127` use `new Float32Array(buffer.buffer, byteOffset, length / 4)`. better-sqlite3 returns Node `Buffer` objects whose `.buffer` is an `ArrayBuffer` whose `byteOffset` may be > 0 on some platforms (pool allocator).
- Why fragile: Misaligned `byteOffset` (not 4-byte aligned) throws `RangeError: start offset of Float32Array should be a multiple of 4`.
- Safe modification: Use `Buffer` index access or copy into a new ArrayBuffer.
- Test coverage: Not covered explicitly in `tests/core/MemoryStore.test.ts`.

**`AgingPipeline` regex rules can collide:**
- Files: `src/layers/AgingPipeline.ts:38-82` — the priority-based rule order and the filler-word removal rules at priority 5 may erase text that an earlier rule (priority 4) had just abbreviated, producing inconsistent compression between calls.
- Why fragile: Order-dependent, deterministic, but small text changes can flip the outcome.
- Safe modification: Add round-trip tests at `tests/layers/AgingPipeline.test.ts` for representative inputs.
- Test coverage: Existing file is `tests/layers/AgingPipeline.test.ts`.

**`ConflictResolver.resolve` priority formula adds tool + event priority:**
- Files: `src/bus/ConflictResolver.ts:156-160` — `getEffectivePriority = toolPrio + eventPrio`. With `ToolPriority.claude-code = 80` and `EventPriority.user = 1`, a user-edited event from claude-code has effective priority 81, higher than a `chatgpt` (50) user-edit (51) but lower than vscode (70) user-edit (71). The intent ("user always wins") is broken.
- Why fragile: Numeric addition is a poor proxy for lexicographic priority.
- Safe modification: Use lexicographic comparison: user-edit > any tool > any auto.
- Test coverage: `tests/bus/ConflictResolver.test.ts` covers this but the priority addition is asserted implicitly.

**Adapter base path lookup via `relative(this.watchPath, filePath)`:**
- Files: `src/bus/adapters/ClaudeAdapter.ts:202-206` and equivalents. Path is split on both `/` and `\\` but if `filePath` is not actually under `watchPath` (e.g., symlink target outside), `relative()` returns a `..`-prefixed path, and `pathParts[0]` becomes `..`, producing wing `..`.
- Why fragile: Symlinks, junctions, mounted volumes.
- Safe modification: Resolve absolute path, verify prefix before split.
- Test coverage: None.

## Scaling Limits

**SQLite single-writer model:**
- Current capacity: WAL mode (line 257) helps readers, but all writes serialize. ~1000 writes/sec on local disk.
- Limit: `Omnimind.create()` registers 4 adapters that each watch a directory and bulk-import; concurrent writes during startup spike.
- Scaling path: Switch to LMDB or move to a server process with connection pooling (would also help the sidecar model in Tauri).

**Memory growth of `processedHashes` Map:**
- Current capacity: Unbounded — `ClaudeAdapter.processedHashes` (`src/bus/adapters/ClaudeAdapter.ts:50`), `CursorAdapter.processedHashes` (`src/bus/adapters/CursorAdapter.ts:47`), etc. Each entry is ~32-byte SHA256 hash + timestamp. With many conversation files churned over months, this map can grow into thousands.
- Limit: Tens of thousands of entries is fine; hundreds of thousands slows lookups and bloats the checkpoint JSON.
- Scaling path: LRU cap (e.g., 10k entries) with on-disk checkpoint persisted with timestamps for pruning.

**HTTP server reads request body without size cap:**
- Current capacity: `src/server.ts:555-568` accumulates `body` string unbounded. `POST /api/import` accepts arbitrary JSON (line 409-423), `POST /api/memories` accepts arbitrary `content` (no max length validation enforced server-side; only client-side Zod in `mcp/server.ts:55`).
- Limit: OOM on a single request.
- Scaling path: Cap `Content-Length`, reject > 10 MB.

**HTTP server binds to all interfaces:**
- Current capacity: `server.listen(PORT)` at `src/server.ts:76` (no host arg) defaults to `0.0.0.0` per Node docs.
- Limit: Any device on the LAN can reach `:8844` and read/delete memories.
- Scaling path: Pass `'127.0.0.1'` as second argument.

## Dependencies at Risk

**`sqlite-vss ^0.1.2`:**
- Risk: Native build; `BENCHMARKS.md:22` notes "Fully integrated on darwin-arm64" but Windows/Linux builds use different prebuilts. The repo's recent commit `d5df250` (`ci: fix Windows copy and Ubuntu linuxdeploy issues`) suggests cross-platform packaging is brittle.
- Impact: Installer fails on Windows/Linux without correct prebuilt; users fall back to brute-force search, but the brute-force path is `LIMIT 1000` (line 263 of `SearchEngine.ts`) so anything beyond 1000 memories becomes lossy.
- Migration plan: Pin to a known-good native version, add CI matrix, or drop sqlite-vss in favor of an in-process HNSW (e.g., `hnswlib-node`).

**`onnxruntime-node ^1.18.0`:**
- Risk: Large native binary, ~80 MB model download (`BENCHMARKS.md:8`), supply chain trust on HuggingFace `Xenova/all-MiniLM-L6-v2`. No integrity verification of the downloaded model (`scripts/download-model.js:14-22`).
- Impact: Subverted model returns arbitrary embeddings.
- Migration plan: Pin model SHA256, verify on download.

**`@xenova/transformers ^2.17.2`:**
- Risk: Major version 2.x; library has been moving targets (mentioned in `BENCHMARKS.md:37` that "manual ONNX inference + Xenova tokenizer was already near-optimal" suggesting the pipeline was once tried and reverted).
- Impact: API breakage on upgrade.
- Migration plan: Hold at tested version, write a small adapter around the `pipeline()` call (`EmbeddingEngine.init`) to swap implementations.

**`@modelcontextprotocol/sdk ^1.0.0`:**
- Risk: MCP SDK is still 1.0 and moving; tool/resource/prompt APIs may change.
- Impact: `src/mcp/server.ts:108-211` would need rework on breaking change.
- Migration plan: Wrap SDK calls behind an internal interface.

**`better-sqlite3 ^11.0.0`:**
- Risk: Native build; cross-platform CI risk similar to `sqlite-vss`.
- Impact: Install failures on niche platforms.
- Migration plan: Pin Node version, test on all targets.

## Missing Critical Features

**Phase 3 "Cross-device sync protocol (encrypted P2P)":**
- Problem: ROADMAP.md Phase 3 lists this under "Remaining". No `sync_protocol*`, `peer*`, or `p2p*` files exist under `src/`.
- Blocks: Multi-device Omnimind use; team sharing.

**Multi-agent memory isolation is partial:**
- Problem: `package.json:24` references it in "Current Sprint", but isolation is only by `namespace` column. There is no enforced prefix per agent — adapters and MCP clients can read each other's namespaces if they guess the namespace string.
- Blocks: Hard separation between, e.g., Claude Code and Cursor in shared workspaces.

**Memory merge UI:**
- Problem: ROADMAP.md Phase 3 marks "Memory merge strategies UI (automatic + manual)" as done, but no Svelte component handles merge conflict resolution in `gui/` (only PredictionsPanel and ConflictsPanel per commit `dd3cafb`). The conflict report is exposed via `/api/bus/conflicts` but no UI consumes it yet.
- Blocks: User-driven conflict resolution.

**Memory-aware context compression (Phase 5 remaining):**
- Problem: ROADMAP.md lists "Memory-aware context compression (truncate while preserving Omnimind context)" as remaining. Current `ContextInjector` (`src/prediction/ContextInjector.ts`) only handles its own token budget; it does not integrate with the host LLM's context window management.
- Blocks: Predicting in long-context scenarios without losing predictions to truncation.

**`Encryption` not initialized anywhere:**
- Problem: `MemoryStoreConfig.encryption` exists (`src/core/MemoryStore.ts:200`) and `CryptoEngine` is implemented and tested, but `MemoryStore.init()` (`src/core/MemoryStore.ts:253-300`) never sets `this.crypto`. The field is declared (`this.crypto: CryptoEngine | null = null`) and only ever set to non-null inside the if-branch at line 354 — which is dead code because nothing initializes it.
- Blocks: The entire at-rest encryption story.

**No `npx omnimind` one-liner for installable setup:**
- Problem: `ROADMAP.md` "Phase 5 Remaining" lists "Published npm package with `npx omnimind` one-liner setup". The package is published (v0.6.5 per `package.json:3`) but the one-liner experience (model download + db init + service start) is not packaged.
- Blocks: Smooth first-run for new users.

## Test Coverage Gaps

**`src/server.ts` HTTP routes:**
- What's not tested: All 30+ HTTP endpoints beyond basic server lifecycle (`tests/server/Server.test.ts` exists but coverage is shallow). The auto-eviction (`POST /api/evict`), archive restore (`POST /api/archive/restore/all`), wisdom aggregation (`POST /api/wisdom/aggregate`), and `POST /api/import` body-size edge cases are not covered.
- Files: `src/server.ts`, `tests/server/Server.test.ts`
- Risk: Refactoring routes silently breaks input parsing.
- Priority: Medium.

**`src/bus/adapters/ClaudeDesktopAdapter.ts`:**
- What's not tested: macOS path resolution (`~/Library/Application Support/Claude/...`), graceful no-op on non-macOS (`src/bus/adapters/ClaudeDesktopAdapter.ts:87-90`), and the `inferWing` fallback chain.
- Files: `src/bus/adapters/ClaudeDesktopAdapter.ts`, `tests/bus/adapters/ClaudeDesktopAdapter.test.ts`
- Risk: Path resolution breaks silently on non-Apple platforms.
- Priority: Medium.

**Conflict resolution vector-clock path:**
- What's not tested: The actual "before/after" vector-clock branches in `ConflictResolver.resolve` are never exercised because `MemoryBus.detectConflict` always passes empty clocks (`src/bus/MemoryBus.ts:218-225`).
- Files: `src/bus/ConflictResolver.ts`, `tests/bus/ConflictResolver.test.ts`
- Risk: Vector-clock code is unverified; if clocks ever get populated, regressions won't be caught.
- Priority: Low (dead path) but fix as part of the vector-clock wiring concern.

**`AgingScheduler`:**
- What's not tested: `AgingScheduler.start()`, `stop()`, `runAgingCheck()` are all untested because the body is empty.
- Files: `src/layers/AgingPipeline.ts:331-363`
- Risk: When the body is implemented, regressions go undetected.
- Priority: Low.

**Encryption round-trip through `MemoryStore`:**
- What's not tested: `CryptoEngine` itself has 6 tests (`tests/core/CryptoEngine.test.ts`), but no test exercises the encrypt-on-store → decrypt-on-read path because that path is unimplemented (see encryption tech debt above).
- Files: `tests/core/MemoryStore.test.ts`, `tests/core/CryptoEngine.test.ts`
- Risk: When the path is wired, broken integration isn't caught.
- Priority: High once encryption is implemented.

**Tauri `src-tauri/src/main.rs`:**
- What's not tested: Bundled-vs-dev fallback (`try_start_bundled_server`, `try_start_dev_server`), port discovery under contention, child process kill on window close.
- Files: `src-tauri/src/main.rs`
- Risk: Tauri sidecar leaks orphaned Node processes on GUI close.
- Priority: Medium.

**`Omnimind.bulkAge()` and `checkAging()` end-to-end:**
- What's not tested: Only `tests/integration/GraphAging.test.ts` exists for aging-related tests; the L0→L1→L2→L3 transition over real SQLite data is uncovered.
- Files: `tests/integration/GraphAging.test.ts`, `tests/layers/AgingPipeline.test.ts`
- Risk: Aging bugs cause silent data loss.
- Priority: High.

**Race conditions in adapter checkpoint + watcher:**
- What's not tested: Concurrent file modification while `processFile` is mid-read, double-save race in `saveCheckpoint`.
- Files: `src/bus/adapters/BaseAdapter.ts`, all four adapters
- Risk: Checkpoint corruption under load.
- Priority: Low.

---

*Concerns audit: 2026-06-18*
