# Local LLM Provider (Ollama & LM Studio) — Design

**Date:** 2026-10-05
**Status:** Draft — awaiting review
**Scope:** MVP. Isolated provider module + one MCP tool + GUI toggle persisted in SQLite. No integration with `AgingPipeline`, `IntentPredictor`, or `MemoryStore`.

## Goal

Allow users running Ollama or LM Studio locally to plug their model into Omnimind for an opt-in summarization tool, **toggleable from the GUI Settings panel**, without changing the default behavior or violating the "100% local, zero API calls" promise.

## Non-goals

- Replacing the ONNX embedding engine. Embeddings stay ONNX (`all-MiniLM-L6-v2`).
- Auto-detecting running LLMs at startup.
- Downloading or pulling models from the GUI. The model must already be available locally; the UI surfaces that requirement clearly.
- Cloud LLM fallback (OpenAI, Anthropic). The interface explicitly refuses non-loopback URLs.
- Wiring the LLM into `AgingPipeline`, `IntentPredictor`, or `NER`. Those are separate specs.
- Streaming responses. Keep requests simple, predictable, easy to test.

## Design principles

1. **Off by default.** Fresh installs ship with `NullProvider`. The Settings panel shows the toggle OFF until the user enables it.
2. **Opt-in from the GUI.** A "Local LLM" card in Settings → persisted in the existing `settings` SQLite table. No restart required after first boot.
3. **Loopback only.** Any URL that resolves to a non-loopback host is refused at construction time.
4. **Loud failure, no silent fallback.** If the LLM is unreachable, the MCP tool and `setLLM` return a structured error. No auto-route to a cloud fallback.
5. **No new dependencies.** Use `node:http` (already used in `src/server.ts`). No `ollama` SDK, no `openai` SDK, no `axios`.
6. **Runtime-swap safe.** `Omnimind.llm` can be replaced without recreating the engine, mirroring the existing `reloadShared()` pattern.

## Architecture

New module `src/core/llm/`:

```
src/core/llm/
  LLMProvider.ts          interface + types
  NullProvider.ts         default no-op
  OllamaProvider.ts       /api/chat over HTTP
  LMStudioProvider.ts     OpenAI-compatible /v1/chat/completions
  guard.ts                assertLoopback(url)
  errors.ts               LLMError union
  index.ts                re-exports
```

### `Omnimind` wiring

`OmnimindConfig` gains one optional field:

```ts
llm?: {
  enabled: boolean;
  provider?: 'ollama' | 'lmstudio';
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
};
```

**At boot** (`Omnimind.create()`):
1. Read env vars `OMNIMIND_LLM_PROVIDER`, `OMNIMIND_LLM_BASE_URL`, `OMNIMIND_LLM_MODEL`, `OMNIMIND_LLM_TIMEOUT_MS`. Env wins over config for boot-time defaults.
2. If `config.llm?.enabled === true` OR any env var is set → `new NullProvider()` initially; settings are read from SQLite at boot via `reloadLLM()` after the store is up.
3. If neither → `new NullProvider()`.
4. Store as `private _llm: LLMProvider = new NullProvider()`, exposed via `readonly llm: LLMProvider` getter.

**At runtime** (after boot):
- GUI calls `POST /api/settings {key: 'llmEnabled', value: 'true'}` (and one POST per other field).
- Server endpoint routes LLM-related keys to `omni.reloadLLM()`.
- `reloadLLM()` reads `llmEnabled`, `llmProvider`, `llmBaseUrl`, `llmModel`, `llmTimeoutMs` from the store and rebuilds the provider. The public `llm` getter returns the current provider instance.

### `reloadLLM()` (mirrors `reloadShared()`)

```ts
async reloadLLM(): Promise<void> {
  const enabled = this.memoryStore.getSetting('llmEnabled');
  if (!enabled.ok || enabled.value !== 'true') {
    this._llm = new NullProvider();
    return;
  }
  const provider = this.memoryStore.getSetting('llmProvider');
  const baseUrl = this.memoryStore.getSetting('llmBaseUrl');
  const model = this.memoryStore.getSetting('llmModel');
  const timeoutMs = this.memoryStore.getSetting('llmTimeoutMs');
  if (!provider.ok || !model.ok || !model.value) {
    this._llm = new NullProvider();
    return;
  }
  const cfg = buildLLMConfig({
    provider: provider.value as 'ollama' | 'lmstudio',
    baseUrl: baseUrl.ok ? baseUrl.value ?? undefined : undefined,
    model: model.value,
    timeoutMs: timeoutMs.ok ? Number(timeoutMs.value) : undefined,
  });
  const result = cfg;
  if (!result.ok) {
    this._llm = new NullProvider();
    console.warn(`[Omnimind] LLM config invalid: ${result.error.reason}`);
    return;
  }
  this._llm = createProvider(result.value);
}
```

Invalid config (missing model, bad URL) silently degrades to `NullProvider` and logs once. The GUI surfaces the failure via the next `getLLMStatus()` call.

### Provider interface

```ts
// src/core/llm/LLMProvider.ts
export type LLMMessageRole = 'system' | 'user' | 'assistant';

export interface LLMMessage {
  readonly role: LLMMessageRole;
  readonly content: string;
}

export interface LLMSummaryOptions {
  readonly maxWords?: number;
  readonly style?: 'bullet' | 'paragraph';
  readonly signal?: AbortSignal;
}

export interface LLMProvider {
  readonly name: 'null' | 'ollama' | 'lmstudio';
  isConfigured(): boolean;
  summarize(text: string, opts?: LLMSummaryOptions): Promise<Result<string, LLMError>>;
  health(): Promise<Result<true, LLMError>>;
}
```

### Public API additions

```ts
// src/index.ts additions
getLLMConfig(): LLMConfigPublic;                  // what GUI shows
getLLMStatus(): Promise<LLMStatus>;               // live ping
async reloadLLM(): Promise<void>;                 // runtime swap (mirrors reloadShared)
readonly llm: LLMProvider;                        // current provider (getter, not field)
```

```ts
export interface LLMConfigPublic {
  enabled: boolean;
  provider: 'ollama' | 'lmstudio' | null;
  model: string | null;
  baseUrl: string | null;
  timeoutMs: number;
}

export interface LLMStatus {
  configured: boolean;
  provider: 'null' | 'ollama' | 'lmstudio';
  baseUrl?: string;
  model?: string;
  reachable: boolean;
  latencyMs?: number;
  error?: string;
}
```

### Errors

```ts
export type LLMError =
  | { kind: 'unavailable'; cause: string }
  | { kind: 'response'; status: number; body: string }
  | { kind: 'config'; reason: string }
  | { kind: 'aborted' };
```

### `NullProvider`

```ts
export class NullProvider implements LLMProvider {
  readonly name = 'null' as const;
  isConfigured() { return false; }
  async summarize(): Promise<Result<string, LLMError>> {
    return err({ kind: 'config', reason: 'LLM provider not configured' });
  }
  async health(): Promise<Result<true, LLMError>> {
    return err({ kind: 'config', reason: 'LLM provider not configured' });
  }
}
```

### `OllamaProvider`

- POST `{baseUrl}/api/chat`
- Body: `{ model, messages, stream: false, options: { num_predict: maxWords * 2 } }`
- Default `baseUrl`: `http://127.0.0.1:11434`
- Default `model`: `qwen2.5:3b`
- Default `timeoutMs`: 15000
- System prompt (fixed, kept short):
  > "You are a local memory assistant. Summarize the user's text in N words. Preserve concrete details: filenames, function names, error messages, exact decisions. Do not add information that is not in the text. Respond with the summary only."
- Response parsing: read `response.message.content` from JSON body.
- `health()` calls `GET /api/tags` (cheapest ping, ~50ms). If 200 and the requested model appears in `models[].name`, return `ok(true)`. If 200 but model missing, return `err({ kind: 'response', status: 200, body: 'model not pulled' })`.
- HTTP via `node:http.request`. No SDK.

### `LMStudioProvider`

- POST `{baseUrl}/v1/chat/completions` (OpenAI-compatible).
- Body: `{ model, messages, max_tokens: maxWords * 2, temperature: 0.2, stream: false }`
- Default `baseUrl`: `http://127.0.0.1:1234/v1`
- Default `model`: read from `{baseUrl}/v1/models` at first `health()` call, cached.
- Default `timeoutMs`: 15000
- Same system prompt as Ollama.
- Response parsing: read `choices[0].message.content`. Tolerates unknown extra fields.

### `guard.ts`

```ts
export function assertLoopback(url: string): Result<string, LLMError> {
  let u: URL;
  try { u = new URL(url); }
  catch { return err({ kind: 'config', reason: `invalid URL: ${url}` }); }

  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    return err({ kind: 'config', reason: `protocol must be http(s), got ${u.protocol}` });

  const h = u.hostname.toLowerCase();
  const allowed = h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0';
  if (!allowed)
    return err({ kind: 'config', reason: `LLM provider must be loopback, got: ${h}` });

  return ok(u.toString());
}
```

- Runs every time `reloadLLM()` builds a provider. A user editing `baseUrl` in Settings sees the validation result via the next status check.
- `0.0.0.0` accepted because LM Studio binds there by default. Client still resolves to loopback.
- IPv6 `[::1]` supported.

### Default-model policy

If the user enables Ollama but doesn't set `model`, we use `qwen2.5:3b`. If that model isn't pulled, Ollama returns 404 with body `{"error":"model 'qwen2.5:3b' not found, try pulling it first"}`. We surface this verbatim wrapped in `LLMError.response`. No magic auto-pick — explicit error is the contract.

## MCP surface

One new tool in `src/mcp/server.ts`:

### `omnimind_summarize`

Input schema (Zod):
```ts
z.object({
  text: z.string().min(1).max(8000),
  maxWords: z.number().int().min(10).max(500).optional().default(80),
})
```

Output:
- On success: `{ ok: true, summary: string, provider: 'ollama' | 'lmstudio' | 'null', model: string }`
- On LLM-not-configured: `{ ok: false, error: 'LLM not configured. Enable it in Settings → Local LLM.' }`
- On LLM-unavailable: `{ ok: false, error: 'Ollama unreachable at <url>. Check Settings → Local LLM → Test connection.' }`
- On other errors: `{ ok: false, error: '<LLMError message>' }`

## HTTP surface (for the GUI)

Two endpoints, added to `src/server.ts`:

### `GET /api/llm`

Returns:
```json
{
  "config": { "enabled": false, "provider": null, "model": null, "baseUrl": null, "timeoutMs": 15000 },
  "status": { "configured": false, "provider": "null", "reachable": false }
}
```

The settings POST handler routes LLM-related keys to `omni.reloadLLM()`.

Recognized keys: `llmEnabled`, `llmProvider`, `llmBaseUrl`, `llmModel`, `llmTimeoutMs`. Any other key falls through to the existing `setSetting` behavior.

```ts
// inside /api/settings POST handler
if (key === 'llmEnabled' || key === 'llmProvider' ||
    key === 'llmBaseUrl' || key === 'llmModel' || key === 'llmTimeoutMs') {
  await omni!.reloadLLM();
}
```

A separate `GET /api/llm/status` returns the live `LLMStatus` (with latency). The GUI calls it after each save and on the "Test connection" button.

## CLI surface

`omnimind config llm`:
- `omnimind config llm status` — prints provider, baseUrl, model, configured, health result.
- `omnimind config llm enable --provider <ollama|lmstudio> [--base-url URL] [--model NAME] [--timeout-ms N]` — writes to SQLite (persists across restarts) and prints what was set.
- `omnimind config llm disable` — sets `llmEnabled='false'`, calls `reloadLLM()`.
- `omnimind summarize "<text>" [--max-words N]` — direct CLI wrapper for testing outside MCP.

`enable`/`disable` write to the same `settings` keys the GUI uses. Single source of truth.

## Env vars

| Variable | Effect | Default |
|---|---|---|
| `OMNIMIND_LLM_PROVIDER` | Boot-time provider | unset (null) |
| `OMNIMIND_LLM_BASE_URL` | Boot-time base URL | provider default |
| `OMNIMIND_LLM_MODEL` | Boot-time model | provider default |
| `OMNIMIND_LLM_TIMEOUT_MS` | Boot-time timeout | 15000 |

Env vars set `llmEnabled='true'` implicitly only if `OMNIMIND_LLM_PROVIDER` is set. Once the GUI saves a value, the SQLite setting overrides env at next boot (env is fallback for first boot / containers).

## GUI

New section in `gui/src/lib/components/SettingsPanel.svelte`:

```
┌─ Local LLM ────────────────────────────────────────┐
│  Enable local LLM provider        [ ○ OFF  ● ON ]  │
│  Provider:  ( ) Ollama   ( ) LM Studio             │
│  Base URL:  [ http://127.0.0.1:11434           ]   │
│  Model:     [ qwen2.5:3b                       ]   │
│  Timeout:   [ 15000 ] ms                            │
│                                                    │
│  Status: ● Connected (124ms, model loaded)          │
│     or    ○ Disconnected (Ollama unreachable)       │
│     or    ⚠ Connected but model not loaded          │
│                                                    │
│  [ Test connection ]                                │
└─────────────────────────────────────────────────────┘
```

Behavior:
- Toggle OFF → `POST /api/settings {key: 'llmEnabled', value: 'false'}` → `reloadLLM()` swaps in `NullProvider`. Existing data unaffected.
- Toggle ON + fill fields → `POST` each field one at a time (matching existing per-key pattern). After each save, the UI calls `GET /api/llm/status` and updates the status indicator.
- "Test connection" → `GET /api/llm/status`, displays latency or error.
- If `status.reachable === false` and `status.provider === 'ollama'`: show "Is Ollama running? Open the Ollama app or run `ollama serve` in a terminal." alongside the error.
- If `status.reachable === true` but model missing: show "Run `ollama pull qwen2.5:3b` (or your chosen model) in a terminal." with a copy-to-clipboard button.

## Testing strategy

### Unit tests (`tests/core/llm/`)

- `NullProvider.test.ts` — `isConfigured()` returns false; `summarize` returns err; `health` returns err.
- `guard.test.ts` — table-driven over URLs: `http://localhost:11434`, `http://127.0.0.1:11434`, `http://[::1]:11434`, `http://0.0.0.0:1234/v1` pass; `https://api.openai.com`, `http://8.8.8.8`, `ftp://localhost`, `not-a-url` fail.
- `OllamaProvider.test.ts` — uses a tiny in-test HTTP server (`node:http.createServer`) that mimics Ollama's `/api/chat` and `/api/tags`. Verifies request body shape, headers, response parsing, error mapping for 404/500/timeout.
- `LMStudioProvider.test.ts` — same pattern, OpenAI shape.
- `errors.test.ts` — `Result.err(LLMError)` narrowing works through the project's existing helpers.

### Integration tests (`tests/integration/llm.test.ts`)

- `reloadLLM` lifecycle: write settings to SQLite → call `reloadLLM()` → assert `omni.llm.name` matches expected.
- Toggle OFF path: assert `omni.llm instanceof NullProvider`.
- Invalid config path: write `llmBaseUrl='https://api.openai.com'` → `reloadLLM()` → assert still `NullProvider`, error logged.
- Health ping with mock HTTP server: returns `reachable: true` with latency.

### MCP test (`tests/mcp/llm-summarize.test.ts`)

- Mock `LLMProvider` injected via test factory. Register the MCP tool handler. Assert: input schema validates; success path returns `ok: true`; null-provider path returns `ok: false` with the "not configured" error; unavailable path returns `ok: false` with the unreachable error.

### HTTP endpoint test (`tests/server/llm-endpoint.test.ts`)

- `GET /api/llm` returns the config + status shape.
- `POST /api/settings {key: 'llmEnabled', value: 'true'}` with valid other settings → `reloadLLM()` invoked → next `GET /api/llm/status` shows reachable.

### Live integration (gated)

`tests/integration/llm-live.test.ts` — only runs when `OMNIMIND_LLM_TEST_LIVE=1`. Skipped by default in CI. If `OLLAMA_HOST` is reachable, hit real Ollama with a 5-word prompt, assert non-empty response within 10s. Not part of coverage thresholds.

### Coverage

LLM module counts toward the 80/80/70/80 thresholds. To meet them, the providers need real unit tests (the HTTP-mock server counts), not just constructor tests.

## File-by-file change list

| File | Action | Approx LOC |
|---|---|---|
| `src/core/llm/LLMProvider.ts` | NEW | +50 |
| `src/core/llm/NullProvider.ts` | NEW | +25 |
| `src/core/llm/OllamaProvider.ts` | NEW | +140 |
| `src/core/llm/LMStudioProvider.ts` | NEW | +120 |
| `src/core/llm/guard.ts` | NEW | +30 |
| `src/core/llm/errors.ts` | NEW | +25 |
| `src/core/llm/index.ts` | NEW | +10 |
| `src/index.ts` | EDIT — `OmnimindConfig.llm`, `llm` getter, `reloadLLM`, `getLLMConfig`, `getLLMStatus` | +60 |
| `src/mcp/server.ts` | EDIT — register `omnimind_summarize` | +50 |
| `src/server.ts` | EDIT — `/api/llm`, `/api/llm/status`, route LLM keys in `/api/settings` | +50 |
| `src/cli.ts` | EDIT — `config llm status/enable/disable`, `summarize` commands | +140 |
| `gui/src/lib/components/SettingsPanel.svelte` | EDIT — Local LLM card | +120 |
| `gui/src/lib/api.ts` | EDIT — `llmConfig()`, `llmStatus()`, setSetting already exists | +25 |
| `tests/core/llm/*.test.ts` | NEW (4 files) | +400 |
| `tests/integration/llm.test.ts` | NEW — reloadLLM lifecycle | +150 |
| `tests/mcp/llm-summarize.test.ts` | NEW | +120 |
| `tests/server/llm-endpoint.test.ts` | NEW | +100 |
| `tests/integration/llm-live.test.ts` | NEW (gated) | +60 |
| `docs/adr/0006-local-llm-provider.md` | NEW | (already exists) |
| `README.md`, `docs/USAGE.md` | EDIT — Local LLM section | +50 |

**Estimated total:** ~17-19h. Up from the 12-14h of the env-only version; the ~5h delta is Settings UI + persistence + `reloadLLM` lifecycle + the live status endpoint.

## Risks

1. **GUI toggle + runtime swap race.** If a user toggles ON while a `summarize()` call is in-flight on the old provider, the call completes on the old one and the next call sees the new one. `LLMProvider` instances are not shared mutable state, so this is safe.
2. **Per-key POST + N round-trips.** Five POSTs to enable the LLM (enable, provider, baseUrl, model, timeout) is more network chatter than a single batch. Mirrors existing `shared*` pattern; users don't notice the latency on localhost.
3. **First-token latency on Ollama cold-start.** 3B models on Apple Silicon usually respond in <2s for short prompts; 7B can hit 5-8s. Default `timeoutMs: 15000` should cover it. Status endpoint uses `/api/tags` which is fast.
4. **Markdown/JSON extras in LM Studio responses.** Parsing tolerates unknown fields; only `choices[0].message.content` is required.
5. **`reloadLLM()` failure modes.** If `setSetting` itself errors (disk full, SQLite locked), the GUI shows the error and the previous provider stays active. We do not throw from `reloadLLM`.
6. **Spec placement.** Putting providers under `src/core/llm/` keeps them with the embedding engine. Mirrors the existing `src/core/ner/` pattern.

## What this spec does NOT cover

- Wiring the LLM into `AgingPipeline`. Separate spec.
- Using the LLM for NER. Separate spec.
- Using the LLM for `IntentPredictor` query rewriting. Separate spec.
- A GUI card for "pull this model" — we surface the command but don't auto-pull.
- Cloud LLM providers behind a feature flag. Explicitly out of scope; the loopback guard is the loud refusal.
- GUI installer for Ollama itself (separate download). Not in scope.

## Acceptance criteria

1. `npm run typecheck` passes.
2. `npm test` passes; coverage thresholds (80/80/70/80) met including the new module.
3. `npm run lint` passes.
4. `npm run build` succeeds.
5. With Ollama running locally and `qwen2.5:3b` pulled, the GUI Settings panel "Local LLM" card shows "Connected (latency, model loaded)" within 2s of toggling ON.
6. With Ollama stopped, the same card shows "Disconnected (Ollama unreachable)" with a hint to start the Ollama app.
7. With `llmEnabled='false'`, the GUI toggle is OFF, `omni.llm` is `NullProvider`, and `omnimind_summarize` via MCP returns the structured "not configured" error.
8. With `llmEnabled='true'` and `llmBaseUrl='https://api.openai.com'` saved, `reloadLLM()` returns `omni.llm` as `NullProvider`, logs the guard error, and the GUI status shows "Disconnected (config invalid: LLM provider must be loopback)".
9. `omnimind config llm enable --provider ollama --model llama3.2:3b` from CLI persists to SQLite; next `omnimind summarize "..."` uses that model.
10. Toggling OFF in the GUI immediately makes `omnimind_summarize` via MCP return the "not configured" error without restarting Omnimind.