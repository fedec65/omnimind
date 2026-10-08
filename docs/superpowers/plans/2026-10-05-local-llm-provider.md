# Local LLM Provider — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in, off-by-default, loopback-only local LLM provider (Ollama + LM Studio) to Omnimind, exposed as a swappable `LLMProvider` on the `Omnimind` class, one MCP tool (`omnimind_summarize`), GUI Settings toggles, CLI commands, and REST endpoints — without violating the "100% local, zero API calls" promise.

**Architecture:** New isolated module `src/core/llm/` holds a `LLMProvider` interface with `NullProvider` (default), `OllamaProvider`, and `LMStudioProvider` implementations, plus a `guard.assertLoopback(url)` that refuses any non-loopback base URL and a tagged `LLMError` union. All HTTP goes through `node:http` via a shared `requestJson` helper. `Omnimind` gains an `llm` getter, `getLLMConfig()`, `getLLMStatus()`, and `reloadLLM()` (mirroring `reloadShared()`), so the provider is swapped at runtime without recreating the engine. MCP, CLI, REST, and the GUI all read/write the same five SQLite settings keys (`llmEnabled`, `llmProvider`, `llmBaseUrl`, `llmModel`, `llmTimeoutMs`), giving a single source of truth.

**Tech Stack:** TypeScript 5.5 (strict, `exactOptionalPropertyTypes`), ES modules (`NodeNext`), `better-sqlite3` settings table, `node:http` (server `request` + client mock tests), Zod + `zod-to-json-schema` (MCP tool), Vitest + v8 coverage, Svelte 5 GUI.

**Spec:** `docs/superpowers/specs/2026-10-05-local-llm-provider-design.md`
**ADR:** `docs/adr/0006-local-llm-provider.md`
**Branch:** `feat/local-llm-provider` off `dev`.

## Global Constraints

(From `AGENTS.md`, authoritative — every task must comply.)

- **TypeScript:** `strict: true` with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `isolatedModules`. Module resolution `NodeNext` — **all local imports MUST use the `.js` extension** (e.g. `import { X } from './types.js'`).
- **Error handling:** All fallible operations return a `Result<T, E>` discriminated union: `{ ok: true, value } | { ok: false, error }`, with helpers `ok()`/`err()` from `src/core/types.ts`. **Never throw for expected failures**; unwrap with `if (!result.ok) return err(result.error)`.
- **Interfaces:** all properties `readonly`; optional properties typed `prop?: Type | undefined` (required by `exactOptionalPropertyTypes`); `as const` for constant objects.
- **Logging:** log prefix `[Omnimind]` for the LLM subsystem (e.g. `console.warn(\`[Omnimind] LLM config invalid: ...\`)`, mirroring `reloadShared()`).
- **Testing:** Vitest with modules imported explicitly (`import { describe, it, expect, beforeEach, afterEach } from 'vitest'`). In-memory/temp SQLite via `mkdtempSync(join(tmpdir(), 'omnimind-...'))`; clean up in `afterEach` with `rmSync(tmpDir, { recursive: true, force: true })` and close mock HTTP servers. Always assert `result.ok` before touching `result.value`. Test timeout 30s.
- **Coverage thresholds (enforced, `vitest.config.ts`):** Lines 80%, Functions 80%, Branches 70%, Statements 80%. Coverage is scoped to `src/**` with exclusions for entry points. The new `src/core/llm/*` modules count toward these thresholds — providers need real unit tests (the mock HTTP server counts), not just constructor tests.
- **Lint/format:** ESLint (`@typescript-eslint`) + Prettier. Run `npm run typecheck` before committing each task.
- **Conventions:** section separators `// ─── Section Name ───...`; `PascalCase` classes, `camelCase` functions/vars, `UPPER_SNAKE_CASE` constants.

---

### Task 1: `LLMProvider` interface + shared types
**Est:** ~1h

**Files:**
- Create: `src/core/llm/LLMProvider.ts`
- Test: `tests/core/llm/LLMProvider.test.ts`

**Interfaces:**
- Consumes: `type Result<T, E>` + `ok`/`err` from `src/core/types.js`; `type LLMError` from `./errors.js` (created in Task 2).
- Produces:
  - `interface LLMMessage { readonly role: 'system' | 'user' | 'assistant'; readonly content: string }`
  - `interface LLMSummaryOptions { readonly maxWords?: number | undefined; readonly style?: 'bullet' | 'paragraph' | undefined; readonly signal?: AbortSignal | undefined }`
  - `interface LLMConfig { readonly provider: 'ollama' | 'lmstudio'; readonly baseUrl: string; readonly model: string; readonly timeoutMs: number }`
  - `interface LLMProvider { readonly name: 'null' | 'ollama' | 'lmstudio'; isConfigured(): boolean; summarize(text: string, opts?: LLMSummaryOptions | undefined): Promise<Result<string, LLMError>>; health(): Promise<Result<true, LLMError>> }`
  - `interface LLMConfigPublic { readonly enabled: boolean; readonly provider: 'ollama' | 'lmstudio' | null; readonly model: string | null; readonly baseUrl: string | null; readonly timeoutMs: number }`
  - `interface LLMStatus { readonly configured: boolean; readonly provider: 'null' | 'ollama' | 'lmstudio'; readonly baseUrl?: string | undefined; readonly model?: string | undefined; readonly reachable: boolean; readonly latencyMs?: number | undefined; readonly error?: string | undefined }`

- [ ] **Step 1: Write the failing test**

The interface file is pure types (erased at runtime), so the test is a compile/export smoke test that pins the shape and guards against regressions.

```ts
// tests/core/llm/LLMProvider.test.ts
import { describe, it, expect } from 'vitest';
import type {
  LLMMessage,
  LLMSummaryOptions,
  LLMConfig,
  LLMProvider,
  LLMConfigPublic,
  LLMStatus,
} from '../../src/core/llm/LLMProvider.js';
import { err } from '../../src/core/types.js';

describe('LLMProvider types', () => {
  it('exports the expected named types', () => {
    const names = ['LLMMessage', 'LLMSummaryOptions', 'LLMConfig', 'LLMProvider', 'LLMConfigPublic', 'LLMStatus'];
    expect(names).toHaveLength(6);
  });

  it('LLMSummaryOptions shape is compatible with an abbreviated call', () => {
    const opts: LLMSummaryOptions = { maxWords: 80, style: 'paragraph' };
    expect(opts.maxWords).toBe(80);
  });

  it('err() produces a discriminated union usable as an LLM failure', () => {
    const r = err({ kind: 'config', reason: 'LLM provider not configured' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('config');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/llm/LLMProvider.test.ts`
Expected: FAIL with "Failed to resolve import ... '../../src/core/llm/LLMProvider.js' — no such file exists" (module has not been created yet).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/llm/LLMProvider.ts
/**
 * LLMProvider — pluggable local LLM interface (Ollama, LM Studio).
 * Off by default: the concrete default is NullProvider (Task 4).
 */
import type { Result } from '../types.js';

/** A single chat message sent to a local LLM. */
export interface LLMMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

/** Options for a summarize() call. */
export interface LLMSummaryOptions {
  readonly maxWords?: number | undefined;
  readonly style?: 'bullet' | 'paragraph' | undefined;
  readonly signal?: AbortSignal | undefined;
}

/** Resolved provider configuration after defaults + loopback validation. */
export interface LLMConfig {
  readonly provider: 'ollama' | 'lmstudio';
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs: number;
}

/** A swappable local LLM provider. */
export interface LLMProvider {
  readonly name: 'null' | 'ollama' | 'lmstudio';
  isConfigured(): boolean;
  summarize(text: string, opts?: LLMSummaryOptions | undefined): Promise<Result<string, import('./errors.js').LLMError>>;
  health(): Promise<Result<true, import('./errors.js').LLMError>>;
}

/** Public config exposed to the GUI (what Settings shows). */
export interface LLMConfigPublic {
  readonly enabled: boolean;
  readonly provider: 'ollama' | 'lmstudio' | null;
  readonly model: string | null;
  readonly baseUrl: string | null;
  readonly timeoutMs: number;
}

/** Live status combining config with a connectivity probe. */
export interface LLMStatus {
  readonly configured: boolean;
  readonly provider: 'null' | 'ollama' | 'lmstudio';
  readonly baseUrl?: string | undefined;
  readonly model?: string | undefined;
  readonly reachable: boolean;
  readonly latencyMs?: number | undefined;
  readonly error?: string | undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/llm/LLMProvider.test.ts && npm run typecheck`
Expected: PASS (test does not throw) and typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/core/llm/LLMProvider.ts tests/core/llm/LLMProvider.test.ts
git commit -m "feat(llm): add LLMProvider interface and shared types"
```

---

### Task 2: `LLMError` tagged union + `llmErrorMessage`
**Est:** ~0.5h

**Files:**
- Create: `src/core/llm/errors.ts`
- Test: `tests/core/llm/errors.test.ts`

**Interfaces:**
- Consumes: nothing (standalone module).
- Produces:
  - `export type LLMError = { kind: 'unavailable'; cause: string } | { kind: 'response'; status: number; body: string } | { kind: 'config'; reason: string } | { kind: 'aborted' }`
  - `export function llmErrorMessage(e: LLMError): string` — human-readable message for each variant (used by CLI, MCP, and `getLLMStatus`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/llm/errors.test.ts
import { describe, it, expect } from 'vitest';
import { llmErrorMessage, type LLMError } from '../../src/core/llm/errors.js';

function isConfig(e: LLMError): boolean {
  return e.kind === 'config';
}

describe('llmErrorMessage', () => {
  it('maps each union variant to a readable string', () => {
    const cases: LLMError[] = [
      { kind: 'unavailable', cause: 'connect ECONNREFUSED 127.0.0.1:11434' },
      { kind: 'response', status: 404, body: "model 'qwen2.5:3b' not found" },
      { kind: 'config', reason: 'LLM provider must be loopback' },
      { kind: 'aborted' },
    ];
    for (const e of cases) {
      const msg = llmErrorMessage(e);
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(0);
    }
  });

  it('narrows a config variant to its reason', () => {
    const e: LLMError = { kind: 'config', reason: 'LLM provider must be loopback' };
    if (isConfig(e)) {
      expect(llmErrorMessage(e)).toBe('LLM provider must be loopback');
    } else {
      throw new Error('expected narrowing to config');
    }
  });

  it('includes status and body for response errors', () => {
    const msg = llmErrorMessage({ kind: 'response', status: 404, body: 'missing' });
    expect(msg).toContain('404');
    expect(msg).toContain('missing');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/llm/errors.test.ts`
Expected: FAIL with "Failed to resolve import .../errors.js" — module not yet created.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/llm/errors.ts
/**
 * Tagged union of local-LLM failures. Distinct from Error because typed
 * callers pattern-match on `kind` rather than catching/reading `.message`.
 */
export type LLMError =
  | { kind: 'unavailable'; cause: string }
  | { kind: 'response'; status: number; body: string }
  | { kind: 'config'; reason: string }
  | { kind: 'aborted' };

/** Human-readable message for an LLMError, used by CLI/MCP/server output. */
export function llmErrorMessage(e: LLMError): string {
  switch (e.kind) {
    case 'unavailable':
      return e.cause;
    case 'response':
      return `LLM responded ${e.status}: ${e.body}`;
    case 'config':
      return e.reason;
    case 'aborted':
      return 'LLM request aborted';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/llm/errors.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/llm/errors.ts tests/core/llm/errors.test.ts
git commit -m "feat(llm): add LLMError tagged union and llmErrorMessage"
```

---

### Task 3: `assertLoopback` guard
**Est:** ~0.5h

**Files:**
- Create: `src/core/llm/guard.ts`
- Test: `tests/core/llm/guard.test.ts`

**Interfaces:**
- Consumes: `type Result<T,E>` + `ok`/`err` from `../types.js`; `type LLMError` from `./errors.js`.
- Produces: `export function assertLoopback(url: string): Result<string, LLMError>` — accepts `http`/`https` schemes and the hosts `localhost`, `127.0.0.1`, `::1`, `0.0.0.0` (LM Studio binds `0.0.0.0`); returns the normalized URL string, else a `config` error. Consumed by `buildLLMConfig` inside Task 9's `reloadLLM()`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/llm/guard.test.ts
import { describe, it, expect } from 'vitest';
import { assertLoopback } from '../../src/core/llm/guard.js';

describe('assertLoopback', () => {
  it.each([
    ['http://127.0.0.1:11434', 'http://127.0.0.1:11434/'],
    ['http://localhost:1234/v1', 'http://localhost:1234/v1'],
    ['http://[::1]:11434', 'http://[::1]:11434/'],
    ['http://0.0.0.0:1234/v1', 'http://0.0.0.0:1234/v1'],
  ])('allows loopback host %s', (input, expected) => {
    const r = assertLoopback(input);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(expected);
  });

  it.each([
    ['https://api.openai.com/v1', 'LLM provider must be loopback'],
    ['http://example.com:9999', 'LLM provider must be loopback'],
    ['ftp://127.0.0.1/foo', 'protocol must be http(s)'],
    ['not a url', 'invalid URL'],
  ])('rejects %s', (input, reasonFragment) => {
    const r = assertLoopback(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.reason).toContain(reasonFragment);
  });

  it('accepts an explicit https scheme on a loopback host', () => {
    const r = assertLoopback('https://localhost:8080');
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/llm/guard.test.ts`
Expected: FAIL with "Failed to resolve import .../guard.js" — module not yet created.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/llm/guard.ts
/**
 * Loopback guard: refuses any base URL that resolves to a non-loopback host.
 * Run every time the engine rebuilds a provider, so a user editing baseUrl in
 * Settings sees the result via the next status check.
 */
import { type Result, ok, err } from '../types.js';
import type { LLMError } from './errors.js';

export function assertLoopback(url: string): Result<string, LLMError> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return err({ kind: 'config', reason: `invalid URL: ${url}` });
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return err({ kind: 'config', reason: `protocol must be http(s), got ${u.protocol}` });
  }

  const h = u.hostname.toLowerCase();
  const allowed = h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0';
  if (!allowed) {
    return err({ kind: 'config', reason: `LLM provider must be loopback, got: ${h}` });
  }

  return ok(u.toString());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/llm/guard.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/llm/guard.ts tests/core/llm/guard.test.ts
git commit -m "feat(llm): add assertLoopback guard"
```

---

### Task 4: `NullProvider` no-op default
**Est:** ~0.5h

**Files:**
- Create: `src/core/llm/NullProvider.ts`
- Test: `tests/core/llm/NullProvider.test.ts`

**Interfaces:**
- Consumes: `type Result` + `err` from `../types.js`; `type LLMError` from `./errors.js`; `type LLMProvider` from `./LLMProvider.js`.
- Produces: `export class NullProvider implements LLMProvider` — `name = 'null'`, `isConfigured() => false`, `summarize`/`health` always return `err({ kind: 'config', reason: 'LLM provider not configured' })`. Consumed as the default `_llm` in Task 9.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/llm/NullProvider.test.ts
import { describe, it, expect } from 'vitest';
import { NullProvider } from '../../src/core/llm/NullProvider.js';

describe('NullProvider', () => {
  it('is unconfigured by definition', () => {
    const p = new NullProvider();
    expect(p.name).toBe('null');
    expect(p.isConfigured()).toBe(false);
  });

  it('summarize always returns a config error', async () => {
    const r = await new NullProvider().summarize('hello world');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('config');
  });

  it('health always returns a config error', async () => {
    const r = await new NullProvider().health();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('config');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/llm/NullProvider.test.ts`
Expected: FAIL with "no such file or directory ... NullProvider.js".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/llm/NullProvider.ts
/** Default no-op provider: off by default until a user opts in. */
import { type Result, err } from '../types.js';
import type { LLMError } from './errors.js';
import type { LLMProvider } from './LLMProvider.js';

export class NullProvider implements LLMProvider {
  readonly name = 'null' as const;

  isConfigured(): boolean {
    return false;
  }

  async summarize(): Promise<Result<string, LLMError>> {
    return err({ kind: 'config', reason: 'LLM provider not configured' });
  }

  async health(): Promise<Result<true, LLMError>> {
    return err({ kind: 'config', reason: 'LLM provider not configured' });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/llm/NullProvider.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/llm/NullProvider.ts tests/core/llm/NullProvider.test.ts
git commit -m "feat(llm): add NullProvider default no-op"
```

---

### Task 5: Shared JSON HTTP helper (`requestJson`)
**Est:** ~1h
**Note (deliberate DRY deviation):** the spec's `src/core/llm/` file list omits a shared HTTP helper, but both providers need identical `node:http` request logic. Adding `httpRequest.ts` avoids copy-paste between `OllamaProvider` and `LMStudioProvider` (Task 6/7). Flagged in the plan; delete-in-place if reviewers prefer inline.

**Files:**
- Create: `src/core/llm/httpRequest.ts`
- Test: `tests/core/llm/httpRequest.test.ts` (standalone unit coverage; provider tests exercise it end-to-end too)

**Interfaces:**
- Consumes: `type Result` + `ok`/`err` from `../types.js`; `type LLMError` from `./errors.js`.
- Produces:
  - `interface JsonRequestOptions { readonly url: string; readonly method?: 'GET' | 'POST' | undefined; readonly body?: unknown | undefined; readonly headers?: Record<string, string> | undefined; readonly timeoutMs: number; readonly signal?: AbortSignal | undefined }`
  - `export function requestJson(opts: JsonRequestOptions): Promise<Result<unknown, LLMError>>` — resolves to the parsed JSON response body on 2xx; `{ kind:'response', status, body }` on non-2xx; `{ kind:'unavailable', cause }` on connect failure/timeout; `{ kind:'aborted' }` when `signal` aborts; `{ kind:'config', reason }` on malformed URL/scheme. Handles `http:` and `https:`.

- [ ] **Step 1: Write the failing test**

Mock server on port 0:
```ts
// tests/core/llm/httpRequest.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server as HttpServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { requestJson } from '../../src/core/llm/httpRequest.js';

let server: HttpServer;
let base: string;
const seen: Array<{ url: string; method: string; body: string }> = [];
let respondWith: { status: number; json: unknown } = { status: 200, json: { ok: true } };

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      seen.push({ url: req.url ?? '', method: req.method ?? '', body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(respondWith.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(respondWith.json));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('requestJson', () => {
  it('posts a JSON body and returns the parsed response', async () => {
    respondWith = { status: 200, json: { ok: true } };
    const r = await requestJson({ url: `${base}api/chat`, method: 'POST', body: { model: 'qwen2.5:3b' }, timeoutMs: 5000 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ ok: true });
    expect(seen.at(-1)?.url).toBe('/api/chat');
    expect(JSON.parse(seen.at(-1)?.body ?? '{}')).toEqual({ model: 'qwen2.5:3b' });
  });

  it('GETs without a body', async () => {
    respondWith = { status: 200, json: { models: [] } };
    const r = await requestJson({ url: `${base}api/tags`, method: 'GET', timeoutMs: 5000 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ models: [] });
    expect(seen.at(-1)?.method).toBe('GET');
    expect(seen.at(-1)?.body).toBe('');
  });

  it('returns response error on non-2xx', async () => {
    respondWith = { status: 404, json: { error: 'nope' } };
    const r = await requestJson({ url: `${base}missing`, method: 'GET', timeoutMs: 5000 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('response');
      if (r.error.kind === 'response') {
        expect(r.error.status).toBe(404);
        expect(r.error.body).toContain('nope');
      }
    }
  });

  it('returns unavailable on connection refused', async () => {
    const r = await requestJson({ url: 'http://127.0.0.1:1/nope', method: 'GET', timeoutMs: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('unavailable');
  });

  it('returns config error on a non-http URL', async () => {
    const r = await requestJson({ url: 'ftp://127.0.0.1/x', method: 'GET', timeoutMs: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('config');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/llm/httpRequest.test.ts`
Expected: FAIL with "no such file or directory ... httpRequest.js".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/llm/httpRequest.ts
/**
 * Minimal JSON HTTP client for local LLM providers. Uses node:http only
 * (matches src/server.ts); no fetch, no SDK. Non-2xx becomes a `response`
 * LLMError; connect failure / timeout becomes `unavailable`; abort becomes
 * `aborted`.
 */
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { type Result, ok, err } from '../types.js';
import type { LLMError } from './errors.js';

export interface JsonRequestOptions {
  readonly url: string;
  readonly method?: 'GET' | 'POST' | undefined;
  readonly body?: unknown | undefined;
  readonly headers?: Record<string, string> | undefined;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal | undefined;
}

export function requestJson(opts: JsonRequestOptions): Promise<Result<unknown, LLMError>> {
  return new Promise((resolve) => {
    let u: URL;
    try {
      u = new URL(opts.url);
    } catch {
      resolve(err({ kind: 'config', reason: `invalid URL: ${opts.url}` }));
      return;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      resolve(err({ kind: 'config', reason: `protocol must be http(s), got ${u.protocol}` }));
      return;
    }

    const method = opts.method ?? 'POST';
    const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const reqFn = u.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = reqFn(
      u,
      {
        method,
        timeout: opts.timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          ...(payload !== undefined ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...opts.headers,
        },
      },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            resolve(err({ kind: 'response', status, body: text }));
            return;
          }
          resolve(ok(parseJson(text)));
        });
      },
    );

    req.on('timeout', () => {
      req.destroy();
      resolve(err({ kind: 'unavailable', cause: `request timed out after ${opts.timeoutMs}ms` }));
    });
    req.on('error', (e) => resolve(err({ kind: 'unavailable', cause: e.message })));

    if (opts.signal) {
      const onAbort = (): void => {
        req.destroy();
        resolve(err({ kind: 'aborted' }));
      };
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/llm/httpRequest.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/llm/httpRequest.ts tests/core/llm/httpRequest.test.ts
git commit -m "feat(llm): add node:http JSON request helper"
```

---

### Task 6: `OllamaProvider`
**Est:** ~2h

**Files:**
- Create: `src/core/llm/OllamaProvider.ts`
- Test: `tests/core/llm/OllamaProvider.test.ts`

**Interfaces:**
- Consumes: `type Result` + `ok`/`err` from `../types.js`; `type LLMError` from `./errors.js`; `type LLMProvider`, `type LLMConfig` from `./LLMProvider.js`; `requestJson` from `./httpRequest.js`.
- Produces: `export class OllamaProvider implements LLMProvider` — `name = 'ollama'`, `readonly model: string` (public for MCP output), `constructor(config: LLMConfig)`, `isConfigured() => true`, `summarize(text, opts?)` POSTs `{baseUrl}/api/chat` with `{ model, messages, stream:false, options:{ num_predict: maxWords*2 } }` and reads `response.message.content`; `health()` GETs `{baseUrl}/api/tags` and returns `ok(true)` when the model is present, else `err({kind:'response', status:200, body:'model not pulled'})`. Defaults are filled in by `buildLLMConfig` (Task 9): baseUrl `http://127.0.0.1:11434`, model `qwen2.5:3b`, timeoutMs 15000.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/llm/OllamaProvider.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OllamaProvider } from '../../src/core/llm/OllamaProvider.js';

const SYSTEM_PROMPT =
  "You are a local memory assistant. Summarize the user's text in N words. Preserve concrete details: filenames, function names, error messages, exact decisions. Do not add information that is not in the text. Respond with the summary only.";

let server: HttpServer;
let base: string;
let chatBody: unknown = null;
let chatStatus = 200;
let chatJson: unknown = { message: { content: 'summary' } };
let tagsStatus = 200;
let tagsJson: unknown = { models: [{ name: 'qwen2.5:3b' }] };

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      if (req.url === '/api/chat') {
        chatBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        res.writeHead(chatStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(chatJson));
      } else if (req.url === '/api/tags') {
        res.writeHead(tagsStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(tagsJson));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end('{}');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function make(): OllamaProvider {
  return new OllamaProvider({ provider: 'ollama', baseUrl: base, model: 'qwen2.5:3b', timeoutMs: 5000 });
}

describe('OllamaProvider', () => {
  it('reports its name and isConfigured', () => {
    const p = make();
    expect(p.name).toBe('ollama');
    expect(p.isConfigured()).toBe(true);
  });

  it('summarize posts the expected body and returns the message content', async () => {
    chatStatus = 200;
    chatJson = { message: { content: 'the summary here' } };
    const r = await make().summarize('some long text', { maxWords: 40 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('the summary here');
    const c = chatBody as { model: string; messages: Array<{ role: string; content: string }>; stream: boolean; options: { num_predict: number } };
    expect(c.model).toBe('qwen2.5:3b');
    expect(c.stream).toBe(false);
    expect(c.options.num_predict).toBe(80);
    expect(c.messages[0].role).toBe('system');
    expect(c.messages[0].content).toBe(SYSTEM_PROMPT);
    expect(c.messages[1]).toEqual({ role: 'user', content: 'some long text' });
  });

  it('returns response error when Ollama has not pulled the model', async () => {
    chatStatus = 404;
    chatJson = { error: "model 'qwen2.5:3b' not found, try pulling it first" };
    const r = await make().summarize('hello');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('response');
      if (r.error.kind === 'response') expect(r.error.status).toBe(404);
    }
  });

  it('health returns ok when the model is present', async () => {
    tagsStatus = 200;
    tagsJson = { models: [{ name: 'qwen2.5:3b' }] };
    const r = await make().health();
    expect(r.ok).toBe(true);
  });

  it('health returns model-not-pulled when the model is missing', async () => {
    tagsStatus = 200;
    tagsJson = { models: [{ name: 'llama3.2:3b' }] };
    const r = await make().health();
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === 'response') expect(r.error.body).toBe('model not pulled');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/llm/OllamaProvider.test.ts`
Expected: FAIL with "no such file or directory ... OllamaProvider.js".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/llm/OllamaProvider.ts
/** Ollama provider — POST {base}/api/chat, GET {base}/api/tags for health. */
import { type Result, ok, err } from '../types.js';
import type { LLMError } from './errors.js';
import type { LLMProvider, LLMConfig, LLMSummaryOptions } from './LLMProvider.js';
import { requestJson } from './httpRequest.js';

const SYSTEM_PROMPT =
  "You are a local memory assistant. Summarize the user's text in N words. Preserve concrete details: filenames, function names, error messages, exact decisions. Do not add information that is not in the text. Respond with the summary only.";

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama' as const;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: LLMConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.model = config.model;
    this.timeoutMs = config.timeoutMs;
  }

  isConfigured(): boolean {
    return true;
  }

  async summarize(text: string, opts?: LLMSummaryOptions | undefined): Promise<Result<string, LLMError>> {
    const maxWords = opts?.maxWords ?? 80;
    const result = await requestJson({
      url: `${this.baseUrl}/api/chat`,
      method: 'POST',
      body: {
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
        stream: false,
        options: { num_predict: maxWords * 2 },
      },
      timeoutMs: this.timeoutMs,
      signal: opts?.signal,
    });
    if (!result.ok) return err(result.error);
    const body = result.value as { message?: { content?: unknown } } | undefined;
    if (typeof body?.message?.content !== 'string') {
      return err({ kind: 'response', status: 200, body: 'malformed response' });
    }
    return ok(body.message.content);
  }

  async health(): Promise<Result<true, LLMError>> {
    const result = await requestJson({ url: `${this.baseUrl}/api/tags`, method: 'GET', timeoutMs: this.timeoutMs });
    if (!result.ok) return err(result.error);
    const body = result.value as { models?: Array<{ name?: unknown }> } | undefined;
    const present =
      Array.isArray(body?.models) &&
      body.models.some((m) => typeof m?.name === 'string' && m.name === this.model);
    if (!present) return err({ kind: 'response', status: 200, body: 'model not pulled' });
    return ok(true);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/llm/OllamaProvider.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/llm/OllamaProvider.ts tests/core/llm/OllamaProvider.test.ts
git commit -m "feat(llm): add OllamaProvider"
```

---

### Task 7: `LMStudioProvider`
**Est:** ~1.5h

**Files:**
- Create: `src/core/llm/LMStudioProvider.ts`
- Test: `tests/core/llm/LMStudioProvider.test.ts`

**Interfaces:**
- Consumes: same as Task 6.
- Produces: `export class LMStudioProvider implements LLMProvider` — `name = 'lmstudio'`, `readonly model: string`, `isConfigured() => true`; `summarize(text, opts?)` POSTs `{baseUrl}/chat/completions` with `{ model, messages, max_tokens: maxWords*2, temperature: 0.2, stream: false }` and reads `choices[0].message.content`; `health()` GETs `{baseUrl}/models`, caches the first `data[].id` as the active model (used when no explicit model was configured), and returns `ok(true)`. Defaults come from `buildLLMConfig` (baseUrl `http://127.0.0.1:1234/v1`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/llm/LMStudioProvider.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LMStudioProvider } from '../../src/core/llm/LMStudioProvider.js';

let server: HttpServer;
let base: string;
let chatBody: unknown = null;
let chatStatus = 200;
let chatJson: unknown = { choices: [{ message: { content: 'lm summary' } }] };
let modelsStatus = 200;
let modelsJson: unknown = { data: [{ id: 'autodetect-model' }] };

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      if (req.url === '/chat/completions') {
        chatBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        res.writeHead(chatStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(chatJson));
      } else if (req.url === '/models') {
        res.writeHead(modelsStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(modelsJson));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end('{}');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function make(model = 'my-model'): LMStudioProvider {
  return new LMStudioProvider({ provider: 'lmstudio', baseUrl: base, model, timeoutMs: 5000 });
}

describe('LMStudioProvider', () => {
  it('reports its name and isConfigured', () => {
    const p = make();
    expect(p.name).toBe('lmstudio');
    expect(p.isConfigured()).toBe(true);
  });

  it('summarize posts an OpenAI-compatible body and returns choices[0].message.content', async () => {
    chatStatus = 200;
    chatJson = { choices: [{ message: { content: 'lm summary' } }] };
    const r = await make().summarize('the text', { maxWords: 30 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('lm summary');
    const c = chatBody as { model: string; max_tokens: number; temperature: number; stream: boolean; messages: Array<{ role: string; content: string }> };
    expect(c.model).toBe('my-model');
    expect(c.max_tokens).toBe(60);
    expect(c.temperature).toBe(0.2);
    expect(c.stream).toBe(false);
    expect(c.messages[1]).toEqual({ role: 'user', content: 'the text' });
  });

  it('health autodetects and caches the model from /models', async () => {
    modelsStatus = 200;
    modelsJson = { data: [{ id: 'autodetect-model' }] };
    const r = await make().health();
    expect(r.ok).toBe(true);
    expect((chatBody as { model?: string }).model).toBe('my-model');
  });

  it('returns response error on non-2xx', async () => {
    chatStatus = 503;
    chatJson = { error: 'model loading' };
    const r = await make().summarize('hi');
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === 'response') expect(r.error.status).toBe(503);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/llm/LMStudioProvider.test.ts`
Expected: FAIL with "no such file or directory ... LMStudioProvider.js".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/llm/LMStudioProvider.ts
/** LM Studio provider — OpenAI-compatible /v1/chat/completions, /v1/models for health. */
import { type Result, ok, err } from '../types.js';
import type { LLMError } from './errors.js';
import type { LLMProvider, LLMConfig, LLMSummaryOptions } from './LLMProvider.js';
import { requestJson } from './httpRequest.js';

const SYSTEM_PROMPT =
  "You are a local memory assistant. Summarize the user's text in N words. Preserve concrete details: filenames, function names, error messages, exact decisions. Do not add information that is not in the text. Respond with the summary only.";

export class LMStudioProvider implements LLMProvider {
  readonly name = 'lmstudio' as const;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  /** Model auto-detected from /v1/models on the first health() call. */
  private cachedModel: string | null = null;

  constructor(config: LLMConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.model = config.model;
    this.timeoutMs = config.timeoutMs;
  }

  isConfigured(): boolean {
    return true;
  }

  private activeModel(): string {
    return this.cachedModel ?? this.model;
  }

  async summarize(text: string, opts?: LLMSummaryOptions | undefined): Promise<Result<string, LLMError>> {
    const maxWords = opts?.maxWords ?? 80;
    const result = await requestJson({
      url: `${this.baseUrl}/chat/completions`,
      method: 'POST',
      body: {
        model: this.activeModel(),
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
        max_tokens: maxWords * 2,
        temperature: 0.2,
        stream: false,
      },
      timeoutMs: this.timeoutMs,
      signal: opts?.signal,
    });
    if (!result.ok) return err(result.error);
    const body = result.value as { choices?: Array<{ message?: { content?: unknown } }> } | undefined;
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      return err({ kind: 'response', status: 200, body: 'malformed response' });
    }
    return ok(content);
  }

  async health(): Promise<Result<true, LLMError>> {
    const result = await requestJson({ url: `${this.baseUrl}/models`, method: 'GET', timeoutMs: this.timeoutMs });
    if (!result.ok) return err(result.error);
    const body = result.value as { data?: Array<{ id?: unknown }> } | undefined;
    const firstId = Array.isArray(body?.data) && body.data.length > 0 ? body.data[0]?.id : undefined;
    if (typeof firstId === 'string') this.cachedModel = firstId;
    return ok(true);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/llm/LMStudioProvider.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/llm/LMStudioProvider.ts tests/core/llm/LMStudioProvider.test.ts
git commit -m "feat(llm): add LMStudioProvider"
```

---

### Task 8: `src/core/llm/index.ts` re-exports
**Est:** ~0.25h

**Files:**
- Create: `src/core/llm/index.ts`

**Interfaces:**
- Consumes: all exports from `./LLMProvider.js`, `./errors.js`, `./guard.js`, `./NullProvider.js`, `./OllamaProvider.js`, `./LMStudioProvider.js`, `./httpRequest.js`.
- Produces: one cleanup barrel so other modules import `from './core/llm/index.js'`. No new tests (pure re-export; token savings during import from `src/index.ts`, `src/mcp/server.ts`, `src/cli.ts`).

- [ ] **Step 1: Write the barrel**

```ts
// src/core/llm/index.ts
/** Cleanup barrel for the local-LLM provider module. */
export type {
  LLMMessage,
  LLMSummaryOptions,
  LLMConfig,
  LLMProvider,
  LLMConfigPublic,
  LLMStatus,
} from './LLMProvider.js';
export type { LLMError } from './errors.js';
export { llmErrorMessage } from './errors.js';
export { assertLoopback } from './guard.js';
export { NullProvider } from './NullProvider.js';
export { OllamaProvider } from './OllamaProvider.js';
export { LMStudioProvider } from './LMStudioProvider.js';
export { requestJson, type JsonRequestOptions } from './httpRequest.js';
```

- [ ] **Step 2: Verify the barrel compiles and resolves**

Run: `npx tsc --noEmit --project tsconfig.json && npx vitest run tests/core/llm`
Expected: PASS (all LLM unit tests still green through the direct-file imports, and the barrel type-checks). No failing test is needed here — it is a pure re-export that cannot fail at runtime beyond a type error, so typecheck is the oracle.

- [ ] **Step 3: Commit**

```bash
git add src/core/llm/index.ts
git commit -m "chore(llm): add core/llm barrel re-exports"
```

---

### Task 9: `Omnimind` integration — config field, `llm` getter, `reloadLLM`, config/status queries
**Est:** ~2h
**Spec gap flagged (resolved):** the spec's `reloadLLM()` skeleton nulls out when `!model.value`. That would make LM Studio autodetection impossible (its default model is `''` resolved at health time). To honor the spec's intent we require a model only for `ollama`; LM Studio may omit it and autodetect via `health()`. Also, `buildLLMConfig`/`createProvider` are not in the spec's `src/core/llm/` file list; they live as module-local helpers in `src/index.ts` (only consumed by `reloadLLM`).

**Files:**
- Modify: `src/index.ts` — `OmnimindConfig` (~line 81-103) add `llm` field; class fields + `private _llm` + `llm` getter (~line 113-125); `Omnimind.create()` boot wiring (~line 250-280, after `omni` is constructed and `shared` reload path); new `reloadLLM`/`getLLMConfig`/`getLLMStatus` in the Settings section (~line 884-920, next to `reloadShared`).
- Test: `tests/integration/llm.test.ts` (full lifecycle; also covers the `getLLMConfig`/`getLLMStatus`/`reloadLLM` surface this task adds — see Task 14).

**Interfaces:**
- Consumes: `type LLMProvider`, `type LLMConfig`, `type LLMConfigPublic`, `type LLMStatus` from `./core/llm/index.js`; `NullProvider`, `OllamaProvider`, `LMStudioProvider`, `assertLoopback`, `llmErrorMessage` from `./core/llm/index.js`.
- Produces:
  - `OmnimindConfig.llm?: { enabled: boolean; provider?: 'ollama' | 'lmstudio' | undefined; baseUrl?: string | undefined; model?: string | undefined; timeoutMs?: number | undefined } | undefined`
  - `get llm(): LLMProvider`
  - `getLLMConfig(): LLMConfigPublic`
  - `getLLMStatus(): Promise<LLMStatus>`
  - `async reloadLLM(): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/llm.test.ts
// NOTE: also serves as the basis for Task 14's lifecycle coverage. Written
// here so Task 9 has a real failing test that pins the new public surface.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Omnimind } from '../../src/index.js';

describe('reloadLLM surface', () => {
  let dir: string;
  let fake: HttpServer;
  let base: string;
  let omni: Omnimind;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'omnimind-llm-'));
    fake = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url === '/api/tags') res.end(JSON.stringify({ models: [{ name: 'qwen2.5:3b' }] }));
      else res.end(JSON.stringify({ message: { content: 'hello' } }));
    });
    await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
    omni = await Omnimind.create({ dataDir: dir, adapters: false });
  });

  afterEach(async () => {
    await omni.close();
    await new Promise<void>((resolve) => fake.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  it('defaults to NullProvider and reports disabled config', () => {
    expect(omni.llm.name).toBe('null');
    const cfg = omni.getLLMConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.provider).toBeNull();
  });

  it('reloadLLM() with llmEnabled=true builds an OllamaProvider and reports reachable status', async () => {
    omni.setSetting('llmEnabled', 'true');
    omni.setSetting('llmProvider', 'ollama');
    omni.setSetting('llmBaseUrl', base);
    omni.setSetting('llmModel', 'qwen2.5:3b');
    await omni.reloadLLM();
    expect(omni.llm.name).toBe('ollama');
    const status = await omni.getLLMStatus();
    expect(status.reachable).toBe(true);
    expect(status.provider).toBe('ollama');
  });

  it('reloadLLM() with llmEnabled=false falls back to NullProvider', async () => {
    omni.setSetting('llmEnabled', 'false');
    await omni.reloadLLM();
    expect(omni.llm.name).toBe('null');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/llm.test.ts`
Expected: FAIL — `omni.reloadLLM` / `omni.getLLMStatus` are not defined (`TypeError: omni.reloadLLM is not a function`), and `omni.llm` does not exist.

- [ ] **Step 3: Write minimal implementation**

In `src/index.ts`:

```ts
// ─── Imports (add to the existing block) ───────────────────────────
import {
  type LLMProvider,
  type LLMConfig,
  type LLMConfigPublic,
  type LLMStatus,
  NullProvider,
  OllamaProvider,
  LMStudioProvider,
  assertLoopback,
} from './core/llm/index.js';
```

Add to `OmnimindConfig`:
```ts
  /**
   * Optional local LLM provider (Ollama / LM Studio). Off by default.
   * Boot-time seeding: settings persisted to SQLite win on the next
   * reloadLLM(); env vars OMNIMIND_LLM_* take precedence over this field.
   */
  llm?: {
    enabled: boolean;
    provider?: 'ollama' | 'lmstudio' | undefined;
    baseUrl?: string | undefined;
    model?: string | undefined;
    timeoutMs?: number | undefined;
  } | undefined;
```

Add class field + getter inside `Omnimind`:
```ts
  private _llm: LLMProvider = new NullProvider();

  /** Current local LLM provider (swappable at runtime via reloadLLM). */
  get llm(): LLMProvider {
    return this._llm;
  }
```

In `Omnimind.create()`, immediately after the `omni` instance is constructed (the line `const omni = new Omnimind(...)`) and after the shared-suggestions load, add boot-time LLM seeding + reload (mirrors the env/config precedence in the spec):
```ts
    // ── Local LLM (opt-in, off by default) ───────────────────────────
    // Env vars win over constructor config for boot-time defaults; the
    // persisted SQLite settings win over both on the next reloadLLM().
    const bootLlm = config.llm;
    const envProvider = process.env.OMNIMIND_LLM_PROVIDER;
    if (envProvider !== undefined || bootLlm?.provider !== undefined || bootLlm?.enabled) {
      store.setSetting('llmEnabled', bootLlm?.enabled ? 'true' : 'false');
      if (envProvider !== undefined || bootLlm?.provider !== undefined) {
        store.setSetting('llmProvider', envProvider !== undefined ? envProvider : (bootLlm?.provider as string));
      }
      const envUrl = process.env.OMNIMIND_LLM_BASE_URL;
      if (envUrl !== undefined || bootLlm?.baseUrl !== undefined) {
        store.setSetting('llmBaseUrl', envUrl !== undefined ? envUrl : (bootLlm?.baseUrl as string));
      }
      const envModel = process.env.OMNIMIND_LLM_MODEL;
      if (envModel !== undefined || bootLlm?.model !== undefined) {
        store.setSetting('llmModel', envModel !== undefined ? envModel : (bootLlm?.model as string));
      }
      const envTimeout = process.env.OMNIMIND_LLM_TIMEOUT_MS;
      if (envTimeout !== undefined || bootLlm?.timeoutMs !== undefined) {
        store.setSetting('llmTimeoutMs', envTimeout !== undefined ? envTimeout : String(bootLlm?.timeoutMs));
      }
    }
    await omni.reloadLLM();
```

In the Settings section (`src/index.ts`, next to the shared methods around line 884-920), add:
```ts
  // ─── Local LLM Provider ──────────────────────────────────────────

  /**
   * Rebuild the LLM provider from current settings. Called when the LLM
   * settings change at runtime (GUI Settings save, CLI enable/disable), so
   * no restart is required. Best-effort: invalid config (missing model,
   * non-loopback URL) silently falls back to NullProvider and logs once.
   * Mirrors reloadShared().
   */
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

    const prov = provider.ok && provider.value ? provider.value : process.env.OMNIMIND_LLM_PROVIDER;
    if (prov !== 'ollama' && prov !== 'lmstudio') {
      this._llm = new NullProvider();
      return;
    }
    const m = model.ok && model.value ? model.value : process.env.OMNIMIND_LLM_MODEL;
    // Ollama needs a concrete model; LM Studio may omit it and autodetect
    // via health() (spec gap resolved — see plan note).
    if (prov === 'ollama' && !m) {
      this._llm = new NullProvider();
      return;
    }
    const cfg = buildLLMConfig({
      provider: prov,
      baseUrl: baseUrl.ok && baseUrl.value ? baseUrl.value : process.env.OMNIMIND_LLM_BASE_URL,
      model: m ?? '',
      timeoutMs: timeoutMs.ok && timeoutMs.value
        ? Number(timeoutMs.value)
        : process.env.OMNIMIND_LLM_TIMEOUT_MS !== undefined
          ? Number(process.env.OMNIMIND_LLM_TIMEOUT_MS)
          : undefined,
    });
    if (!cfg.ok) {
      this._llm = new NullProvider();
      console.warn(`[Omnimind] LLM config invalid: ${cfg.error.reason}`);
      return;
    }
    this._llm = createProvider(cfg.value);
  }

  /** Public LLM config for the GUI (what Settings shows). */
  getLLMConfig(): LLMConfigPublic {
    const provider = this._llm.name === 'null' ? null : this._llm.name;
    const enabled = this.memoryStore.getSetting('llmEnabled');
    const model = this.memoryStore.getSetting('llmModel');
    const baseUrl = this.memoryStore.getSetting('llmBaseUrl');
    const timeoutMs = this.memoryStore.getSetting('llmTimeoutMs');
    return {
      enabled: enabled.ok ? enabled.value === 'true' : false,
      provider,
      model: provider === null ? null : model.ok ? model.value : null,
      baseUrl: provider === null ? null : baseUrl.ok ? baseUrl.value : null,
      timeoutMs: timeoutMs.ok ? Number(timeoutMs.value) : 15000,
    };
  }

  /** Live connectivity status (latency + availability) of the current provider. */
  async getLLMStatus(): Promise<LLMStatus> {
    if (!this._llm.isConfigured()) {
      return { configured: false, provider: 'null', reachable: false };
    }
    const started = Date.now();
    const h = await this._llm.health();
    const latencyMs = Date.now() - started;
    const common = { configured: true, provider: this._llm.name, latencyMs };
    if (h.ok) {
      return { ...common, reachable: true };
    }
    return { ...common, reachable: false };
  }
```

And at module scope (bottom of `src/index.ts`) add the two helpers:
```ts
// ─── LLM config helpers ─────────────────────────────────────────────
import type { LLMError } from './core/llm/index.js';

interface LLMConfigInput {
  provider: 'ollama' | 'lmstudio';
  baseUrl?: string | undefined;
  model?: string | undefined;
  timeoutMs?: number | undefined;
}

/** Fill provider defaults then validate loopback. Always returns an LLMConfig. */
function buildLLMConfig(input: LLMConfigInput): Result<LLMConfig, LLMError> {
  const defaults = input.provider === 'ollama'
    ? { baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:3b' }
    : { baseUrl: 'http://127.0.0.1:1234/v1', model: '' };
  const baseUrl = input.baseUrl ?? defaults.baseUrl;
  const guarded = assertLoopback(baseUrl);
  if (!guarded.ok) return err(guarded.error);
  const timeoutMs = input.timeoutMs ?? 15000;
  return ok({
    provider: input.provider,
    baseUrl: guarded.value,
    model: input.model ?? defaults.model,
    timeoutMs,
  });
}

/** Instantiate the concrete provider for a validated config. */
function createProvider(cfg: LLMConfig): LLMProvider {
  return cfg.provider === 'ollama' ? new OllamaProvider(cfg) : new LMStudioProvider(cfg);
}
```

Add `Result` to the type import from `./core/types.js` (already in `import { type Result } from ...` near the top of `src/index.ts`).

- [ ] **Step 4: Run the integration test to verify it passes**

Run: `npx vitest run tests/integration/llm.test.ts && npm run typecheck`
Expected: PASS (the "defaults to NullProvider", "reloadLLM builds OllamaProvider and reports reachable", and "llmEnabled=false → NullProvider" cases green).

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/integration/llm.test.ts
git commit -m "feat(llm): wire LLM provider into Omnimind with reloadLLM"
```

---

### Task 10: HTTP endpoints — `GET /api/llm`, `GET /api/llm/status`, settings routing
**Est:** ~1h

**Files:**
- Modify: `src/server.ts` — add the two endpoints and the `/api/settings` POST key routing. Add the endpoints to the top-of-file comment block (around line 3-23) too.
- Test: `tests/server/llm-endpoint.test.ts` (spawns the compiled server against a temp data dir, mirrors `SetupEndpoints.test.ts`).

**Interfaces:**
- Consumes: `omni.getLLMConfig()`, `omni.getLLMStatus()`, `omni.reloadLLM()` (Task 9).
- Produces:
  - `GET /api/llm` → `{ config: LLMConfigPublic, status: LLMStatus }`
  - `GET /api/llm/status` → `LLMStatus`
  - Settings POST routes keys `llmEnabled`, `llmProvider`, `llmBaseUrl`, `llmModel`, `llmTimeoutMs` to `omni.reloadLLM()`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/llm-endpoint.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('LLM endpoints', () => {
  let server: ChildProcess;
  let port: number;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'omnimind-llm-ep-'));
    const serverPath = join(process.cwd(), 'dist/server.js');
    server = spawn('node', [serverPath], {
      env: {
        ...process.env,
        OMNIMIND_PORT: '0',
        OMNIMIND_SKIP_ADAPTERS: '1',
        OMNIMIND_DATA_DIR: dataDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('startup timeout')), 15000);
      server.stdout?.on('data', (d: Buffer) => {
        const m = d.toString().match(/Listening on http:\/\/(?:localhost|127\.0\.0\.1):(\d+)/);
        if (m) { clearTimeout(timer); resolve(parseInt(m[1]!, 10)); }
      });
      server.on('error', reject);
    });
    const deadline = Date.now() + 30000;
    for (;;) {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      const body = await res.json() as { status?: string };
      if (body.status === 'ok') break;
      if (Date.now() > deadline) throw new Error('server not ready');
      await new Promise((r) => setTimeout(r, 200));
    }
  });

  afterAll(async () => {
    server.kill();
    await new Promise((r) => server.on('exit', r));
    rmSync(dataDir, { recursive: true, force: true });
  });

  const post = (key: string, value: string) =>
    fetch(`http://127.0.0.1:${port}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    }).then((r) => r.json());

  it('GET /api/llm returns a config + status shape with LLM disabled by default', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/llm`);
    const body = await res.json() as { config: { enabled: boolean; provider: string | null; model: string | null; baseUrl: string | null; timeoutMs: number }; status: { provider: string; reachable: boolean; configured: boolean } };
    expect(body.config).toMatchObject({ enabled: false, provider: null, timeoutMs: 15000 });
    expect(body.status).toMatchObject({ configured: false, provider: 'null', reachable: false });
  });

  it('POST settings with llm keys persists and reloadLLM applies them', async () => {
    await post('llmEnabled', 'true');
    await post('llmProvider', 'ollama');
    await post('llmModel', 'qwen2.5:3b');
    const res = await fetch(`http://127.0.0.1:${port}/api/llm`);
    const body = await res.json() as { config: { enabled: boolean; provider: string | null } };
    expect(body.config.enabled).toBe(true);
    expect(body.config.provider).toBe('ollama');
  });

  it('GET /api/llm/status returns a live LLMStatus', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/llm/status`);
    const body = await res.json() as { configured: boolean; provider: string; reachable: boolean };
    expect(typeof body.configured).toBe('boolean');
    expect(['null', 'ollama', 'lmstudio']).toContain(body.provider);
    expect(typeof body.reachable).toBe('boolean');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npx vitest run tests/server/llm-endpoint.test.ts`
Expected: FAIL — `/api/llm` returns 404 (endpoint not registered) / 404 not ok.

- [ ] **Step 3: Write minimal implementation**

In `src/server.ts`:

Add to the top-of-file endpoint comment:
```
 *   GET  /api/llm
 *   GET  /api/llm/status
```

In `handleRequest`, right after the `/api/settings` block:
```ts
  // Local LLM config + status (for the GUI Settings "Local LLM" card).
  if (path === '/api/llm' && method === 'GET') {
    const config = omni!.getLLMConfig();
    const status = await omni!.getLLMStatus();
    sendJson(res, 200, { config, status });
    return;
  }
  if (path === '/api/llm/status' && method === 'GET') {
    const status = await omni!.getLLMStatus();
    sendJson(res, 200, status);
    return;
  }
```

In the `/api/settings` POST handler, extend the routing block (currently `if (key === 'sharedEnabled' || ...)`):
```ts
      if (
        key === 'sharedEnabled' || key === 'sharedServerUrl' || key === 'sharedToken'
      ) {
        // Rebuild the shared client from the new settings — publishing must
        // work without a restart.
        await omni!.reloadShared();
      }
      // LLM keys rebuild the provider at runtime (no restart) via reloadLLM.
      if (
        key === 'llmEnabled' || key === 'llmProvider' ||
        key === 'llmBaseUrl' || key === 'llmModel' || key === 'llmTimeoutMs'
      ) {
        await omni!.reloadLLM();
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && npx vitest run tests/server/llm-endpoint.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts tests/server/llm-endpoint.test.ts
git commit -m "feat(llm): add /api/llm and /api/llm/status endpoints"
```

---

### Task 11: MCP tool — `omnimind_summarize`
**Est:** ~1.5h

**Files:**
- Modify: `src/mcp/server.ts` — add Zod schema reference, tool entry, dispatch case, and handler. The pure logic lives in a new `src/mcp/summarizeTool.ts` for testability.
- Create: `src/mcp/summarizeTool.ts`
- Test: `tests/mcp/summarize.test.ts`

**Interfaces:**
- Consumes: `this.omni.llm` (Task 9), `zodToJsonSchema`, `z`, existing MCP `Server`.
- Produces: MCP tool `omnimind_summarize` with input `{ text: string(1..8000), maxWords?: number default 80 in 10..500 }`. Success → `{ ok: true, summary, provider, model }`; not-configured → `{ ok:false, error:'LLM not configured. Enable it in Settings → Local LLM.' }`; unavailable → `{ ok:false, error:'Local LLM unreachable. Check Settings → Local LLM → Test connection.' }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/mcp/summarize.test.ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { SummarizeInputSchema, buildSummarizeResult } from '../../src/mcp/summarizeTool.js';
import { NullProvider, type LLMProvider } from '../../src/core/llm/index.js';

class FakeProvider implements LLMProvider {
  readonly name = 'ollama' as const;
  readonly model = 'qwen2.5:3b';
  isConfigured(): boolean { return true; }
  async summarize(text: string): Promise<{ ok: true; value: string }> {
    return { ok: true, value: `sum(${text})` };
  }
  async health(): Promise<{ ok: true; value: true }> {
    return { ok: true, value: true };
  }
}

describe('SummarizeInputSchema', () => {
  it('defaults maxWords to 80 when omitted', () => {
    const parsed = SummarizeInputSchema.parse({ text: 'hi' });
    expect(parsed.maxWords).toBe(80);
  });

  it('rejects empty text', () => {
    expect(() => SummarizeInputSchema.parse({ text: '' })).toThrow(z.ZodError);
  });

  it('rejects out-of-range maxWords', () => {
    expect(() => SummarizeInputSchema.parse({ text: 'hi', maxWords: 9 })).toThrow(z.ZodError);
  });
});

describe('buildSummarizeResult', () => {
  it('returns ok:true with summary, provider, model on success', async () => {
    const res = await buildSummarizeResult(new FakeProvider(), 'hello', { maxWords: 80 });
    expect(res.content[0].isError).toBeFalsy();
    const payload = JSON.parse((res.content[0] as { text: string }).text) as Record<string, unknown>;
    expect(payload.ok).toBe(true);
    expect(payload.provider).toBe('ollama');
    expect(payload.model).toBe('qwen2.5:3b');
  });

  it('returns the not-configured error for a NullProvider', async () => {
    const res = await buildSummarizeResult(new NullProvider(), 'hi', { maxWords: 80 });
    const payload = JSON.parse((res.content[0] as { text: string }).text) as Record<string, unknown>;
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain('LLM not configured');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp/summarize.test.ts`
Expected: FAIL with "no such file or directory ... src/mcp/summarizeTool.js".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/mcp/summarizeTool.ts
import { z } from 'zod';
import { type LLMProvider, llmErrorMessage } from '../core/llm/index.js';

export const SummarizeInputSchema = z.object({
  text: z.string().min(1).max(8000),
  maxWords: z.number().int().min(10).max(500).optional(),
});

export interface SummarizeResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean | undefined;
}

/** Shape the omnimind_summarize output for the MCP server. */
export async function buildSummarizeResult(
  provider: LLMProvider,
  text: string,
  opts: { maxWords?: number | undefined },
): Promise<SummarizeResult> {
  if (!provider.isConfigured()) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'LLM not configured. Enable it in Settings → Local LLM.' }) }],
      isError: true,
    };
  }
  const maxWords = opts.maxWords ?? 80;
  const result = await provider.summarize(text, { maxWords });
  if (!result.ok) {
    const reason = result.error.kind === 'unavailable'
      ? 'Local LLM unreachable. Check Settings → Local LLM → Test connection.'
      : llmErrorMessage(result.error);
    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: false, error: reason }) }],
      isError: true,
    };
  }
  const model = (provider as { model?: string }).model;
  return {
    content: [{ type: 'text', text: JSON.stringify({ ok: true, summary: result.value, provider: provider.name, model: model ?? null }) }],
  };
}
```

Register the tool in `src/mcp/server.ts`:

In the tool list (`ListToolsRequestSchema` handler), add:
```ts
        {
          name: 'omnimind_summarize',
          description: 'Summarize a text snippet with a local LLM (Ollama or LM Studio). Requires the Local LLM feature enabled in Settings.',
          inputSchema: zodToJsonSchema(SummarizeInputSchema, 'SummarizeInput') as {
            type: 'object';
            properties: Record<string, unknown>;
          },
        },
```

In the `CallToolRequestSchema` dispatch switch, add:
```ts
          case 'omnimind_summarize':
            return await this.handleSummarize(request.params.arguments);
```

Add the handler next to the other private handlers:
```ts
  private async handleSummarize(args: unknown) {
    const input = SummarizeInputSchema.parse(args);
    return await buildSummarizeResult(this.omni.llm, input.text, { maxWords: input.maxWords });
  }
```

Add imports at the top of `src/mcp/server.ts`:
```ts
import { SummarizeInputSchema, buildSummarizeResult } from './summarizeTool.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcp/summarize.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/summarizeTool.ts src/mcp/server.ts tests/mcp/summarize.test.ts
git commit -m "feat(llm): add omnimind_summarize MCP tool"
```

---

### Task 12: CLI commands — `config llm` + `summarize`
**Est:** ~1.5h

**Files:**
- Modify: `src/cli.ts` — register `config` and `summarize` in the command map, help text, and add `configCommand` + `summarizeCommand`.
- Create: `src/cli/llmFlags.ts` (pure flag-parsing helper, unit-testable).
- Test: `tests/scripts/llmFlags.test.ts`

**Interfaces:**
- Consumes: `Omnimind`, `omni.reloadLLM()`, `omni.getLLMConfig()`, `omni.getLLMStatus()`, `llmErrorMessage`.
- Produces:
  - `omnimind config llm status|enable|disable`
  - `omnimind summarize "<text>" [--max-words N]`

- [ ] **Step 1: Write the failing test**

```ts
// tests/scripts/llmFlags.test.ts
import { describe, it, expect } from 'vitest';
import { parseLlmEnableArgs } from '../../src/cli/llmFlags.js';

describe('parseLlmEnableArgs', () => {
  it('parses provider, base-url, model, timeout', () => {
    const r = parseLlmEnableArgs(['--provider', 'ollama', '--base-url', 'http://127.0.0.1:11434', '--model', 'qwen2.5:3b', '--timeout-ms', '20000']);
    expect(r).toEqual({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:3b', timeoutMs: '20000' });
  });

  it('rejects a missing/unknown provider', () => {
    const r = parseLlmEnableArgs(['--provider', 'openai']);
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scripts/llmFlags.test.ts`
Expected: FAIL with "no such file or directory ... src/cli/llmFlags.js".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/cli/llmFlags.ts
export interface LlmEnableFlagArgs {
  provider: 'ollama' | 'lmstudio';
  baseUrl?: string | undefined;
  model?: string | undefined;
  timeoutMs?: string | undefined;
}

function parseFlag(args: string[], flag: string): string | null {
  const i = args.indexOf(flag);
  if (i < 0) return null;
  const v = args[i + 1];
  return v !== undefined ? v : null;
}

/** Parse `config llm enable` flags; return null on an invalid provider. */
export function parseLlmEnableArgs(args: string[]): LlmEnableFlagArgs | null {
  const provider = parseFlag(args, '--provider');
  if (provider !== 'ollama' && provider !== 'lmstudio') return null;
  const baseUrl = parseFlag(args, '--base-url');
  const model = parseFlag(args, '--model');
  const timeoutMs = parseFlag(args, '--timeout-ms');
  return {
    provider,
    ...(baseUrl !== null ? { baseUrl } : {}),
    ...(model !== null ? { model } : {}),
    ...(timeoutMs !== null ? { timeoutMs } : {}),
  };
}
```

In `src/cli.ts`:

Add to the command map:
```ts
  config: configCommand,
  summarize: summarizeCommand,
```

Add to `printHelp()` (within the existing string template):
```
  config llm status|enable|disable
                    Manage the local LLM provider
    enable --provider <ollama|lmstudio> [--base-url URL] [--model NAME] [--timeout-ms N]
    disable

  summarize <text>  Summarize text with the local LLM
    --max-words <n> Max words (default: 80, 10-500)
```

Add the two command functions:
```ts
async function configCommand(args: string[]): Promise<void> {
  const sub = args[0];
  if (!sub || sub === '--help') {
    console.log(`
Local LLM config commands:
  config llm status
  config llm enable --provider <ollama|lmstudio> [--base-url URL] [--model NAME] [--timeout-ms N]
  config llm disable
`);
    return;
  }
  if (sub !== 'llm') {
    console.error(`Unknown config subcommand: ${sub}`);
    process.exit(1);
  }
  const op = args[1];
  const omni = await Omnimind.create({
    adapters: false,
    dataDir: process.env.OMNIMIND_DATA_DIR ?? undefined,
  });

  try {
    switch (op) {
      case 'status': {
        const cfg = omni.getLLMConfig();
        console.log('Local LLM');
        console.log('==========');
        console.log(`Enabled: ${cfg.enabled}`);
        console.log(`Provider: ${cfg.provider ?? 'null'}`);
        if (cfg.provider) {
          console.log(`Base URL: ${cfg.baseUrl ?? '(default)'}`);
          console.log(`Model: ${cfg.model ?? '(autodetect)'}`);
          console.log(`Timeout: ${cfg.timeoutMs}ms`);
        }
        const status = await omni.getLLMStatus();
        console.log(`Configured: ${status.configured}`);
        console.log(`Reachable: ${status.reachable}` + (status.latencyMs !== undefined ? ` (${status.latencyMs}ms)` : ''));
        break;
      }
      case 'enable': {
        const f = parseLlmEnableArgs(args);
        if (!f) {
          console.error('Usage: omnimind config llm enable --provider <ollama|lmstudio> [--base-url URL] [--model NAME] [--timeout-ms N]');
          process.exit(1);
        }
        omni.setSetting('llmProvider', f.provider);
        if (f.baseUrl) omni.setSetting('llmBaseUrl', f.baseUrl);
        if (f.model) omni.setSetting('llmModel', f.model);
        if (f.timeoutMs) omni.setSetting('llmTimeoutMs', f.timeoutMs);
        omni.setSetting('llmEnabled', 'true');
        await omni.reloadLLM();
        console.log(`Local LLM enabled (${f.provider}).`);
        break;
      }
      case 'disable':
        omni.setSetting('llmEnabled', 'false');
        await omni.reloadLLM();
        console.log('Local LLM disabled.');
        break;
      default:
        console.error('Usage: omnimind config llm status|enable|disable');
        process.exit(1);
    }
  } finally {
    await omni.close();
  }
}

async function summarizeCommand(args: string[]): Promise<void> {
  const text = args[0];
  if (!text) {
    console.error('Usage: omnimind summarize "<text>" [--max-words N]');
    process.exit(1);
  }
  const maxWordsFlag = parseFlag(args, '--max-words');
  const maxWords = maxWordsFlag !== null ? parseInt(maxWordsFlag, 10) : 80;
  const omni = await Omnimind.create({
    adapters: false,
    dataDir: process.env.OMNIMIND_DATA_DIR ?? undefined,
  });
  try {
    await omni.reloadLLM();
    const provider = omni.llm;
    if (!provider.isConfigured()) {
      console.error('LLM not configured. Enable it in Settings → Local LLM, or run: omnimind config llm enable');
      process.exit(1);
    }
    const result = await provider.summarize(text, { maxWords });
    if (result.ok) {
      console.log(result.value);
    } else {
      console.error(`Error: ${llmErrorMessage(result.error)}`);
      process.exit(1);
    }
  } finally {
    await omni.close();
  }
}
```

Add imports at the top of `src/cli.ts`:
```ts
import { parseLlmEnableArgs } from './cli/llmFlags.js';
import { llmErrorMessage } from './core/llm/index.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/scripts/llmFlags.test.ts && npm run typecheck`
Expected: PASS. (Full CLI command behavior is covered by the Task 14 integration test and manual smoke.)

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/cli/llmFlags.ts tests/scripts/llmFlags.test.ts
git commit -m "feat(llm): add config llm and summarize CLI commands"
```

---

### Task 13: GUI — `api.ts` + SettingsPanel Local LLM card
**Est:** ~1.5h

**Files:**
- Modify: `gui/src/lib/api.ts` — add `LlmConfig`, `LlmStatus` interfaces; `llmConfig()`, `llmStatus()` methods.
- Modify: `gui/src/lib/components/SettingsPanel.svelte` — add Local LLM card.

**Interfaces:**
- Consumes: `api.setSetting` (existing), `api.llmConfig`, `api.llmStatus` (new).
- Produces: GUI "Local LLM" card with toggle, provider/baseUrl/model/timeout fields, live status line, and a "Test connection" button.

- [ ] **Step 1: Write the failing test (frontend — no Vitest suite exists in `gui/`, so the contract is verified via `npm run build` plus manual smoke)**

There is no existing GUI test runner (per `gui/package.json`, no test script). Verification for this task is `gui` typecheck/build. The "failing" oracle is the absence of `llmConfig`/`llmStatus` in `api.ts` before this task — Step 2 demonstrates a `tsc` error from a would-be caller, Step 3 adds both definitions and the Svelte card, Step 4 runs the build.

- [ ] **Step 2: Run build to verify it fails (demonstrate a `tsc` error before adding the API surface)**

Skip the manual tsc demo to keep the plan mechanical; rely on Step 4's build as the oracle after the implementation lands.

- [ ] **Step 3: Write minimal implementation**

In `gui/src/lib/api.ts`, add the DTOs near the other response interfaces:
```ts
export interface LlmConfig {
  enabled: boolean;
  provider: 'ollama' | 'lmstudio' | null;
  model: string | null;
  baseUrl: string | null;
  timeoutMs: number;
}

export interface LlmStatus {
  configured: boolean;
  provider: 'null' | 'ollama' | 'lmstudio';
  baseUrl?: string;
  model?: string;
  reachable: boolean;
  latencyMs?: number;
  error?: string;
}

export interface LlmEndpointResponse {
  config: LlmConfig;
  status: LlmStatus;
}
```

Add to the `api` object:
```ts
  llmConfig: () => fetchJson<LlmEndpointResponse>('/api/llm'),

  llmStatus: () => fetchJson<LlmStatus>('/api/llm/status'),
```

In `gui/src/lib/components/SettingsPanel.svelte`, add LLM state to the `form` object:
```ts
    llmEnabled: 'false',
    llmProvider: '',
    llmBaseUrl: '',
    llmModel: '',
    llmTimeoutMs: '15000',
```

Add LLM-specific reactive state near the shared-setup state:
```ts
  let llmStatusMsg = $state<string | null>(null);
  let isTestingLlm = $state(false);
  let llmStatusOk = $state(false);
```

Load LLM config + status in `onMount` (after `settings = await api.settings()`):
```ts
      const llm = await api.llmConfig();
      form.llmEnabled = llm.config.enabled ? 'true' : 'false';
      form.llmProvider = llm.config.provider ?? '';
      form.llmBaseUrl = llm.config.baseUrl ?? '';
      form.llmModel = llm.config.model ?? '';
      form.llmTimeoutMs = String(llm.config.timeoutMs ?? 15000);
```

Add the save handler for LLM fields (persists each key then refreshes status):
```ts
  async function handleSaveLlm() {
    isSaving = true;
    saveMsg = null;
    try {
      await api.setSetting('llmEnabled', form.llmEnabled);
      if (form.llmProvider) await api.setSetting('llmProvider', form.llmProvider);
      if (form.llmBaseUrl) await api.setSetting('llmBaseUrl', form.llmBaseUrl);
      if (form.llmModel) await api.setSetting('llmModel', form.llmModel);
      await api.setSetting('llmTimeoutMs', form.llmTimeoutMs || '15000');
      saveMsg = 'Local LLM settings saved';
      setTimeout(() => (saveMsg = null), 3000);
      await refreshLlmStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save LLM settings');
    } finally {
      isSaving = false;
    }
  }

  async function refreshLlmStatus() {
    const status = await api.llmStatus();
    llmStatusOk = status.reachable && status.configured;
    llmStatusMsg = llmStatusOk
      ? `Connected${status.latencyMs !== undefined ? ` (${status.latencyMs}ms)` : ''}`
      : status.configured
        ? 'Disconnected (check your local LLM is running)'
        : 'Not enabled';
  }
```

"Test connection" handler:
```ts
  async function handleTestLlm() {
    isTestingLlm = true;
    llmStatusMsg = null;
    try {
      await refreshLlmStatus();
    } catch (e) {
      llmStatusOk = false;
      llmStatusMsg = `Test failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      isTestingLlm = false;
    }
  }
```

Add the "Local LLM" card in the template (place after the General section, before the shared/Setup sections; follow the existing `<section class="bg-[var(--surface)] ...">` pattern):
```svelte
      <!-- Local LLM -->
      <section class="bg-[var(--surface)] rounded-xl p-6 border border-[var(--border)]">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wider">Local LLM</h3>
          <label class="flex items-center gap-2 text-sm text-[var(--text)] cursor-pointer">
            <input type="checkbox" checked={form.llmEnabled === 'true'}
              onchange={(e: Event) => (form.llmEnabled = (e.currentTarget as HTMLInputElement).checked ? 'true' : 'false')}
              class="accent-[var(--accent)]" />
            Enabled
          </label>
        </div>
        <p class="text-xs text-[var(--text-muted)] mt-1 mb-4">
          Plug in a local LLM (Ollama or LM Studio) for opt-in summarization. 100% local — never sends data to the cloud.
        </p>
        <div class="space-y-3">
          <div>
            <label class="block text-sm text-[var(--text)] mb-1">Provider</label>
            <select bind:value={form.llmProvider}
              class="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)]">
              <option value="">—</option>
              <option value="ollama">Ollama</option>
              <option value="lmstudio">LM Studio</option>
            </select>
          </div>
          <div>
            <label class="block text-sm text-[var(--text)] mb-1">Base URL</label>
            <input type="text" bind:value={form.llmBaseUrl}
              placeholder="http://127.0.0.1:11434" class="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]" />
            <p class="text-xs text-[var(--text-muted)] mt-1">Loopback only. Must be running locally.</p>
          </div>
          <div>
            <label class="block text-sm text-[var(--text)] mb-1">Model</label>
            <input type="text" bind:value={form.llmModel} placeholder="qwen2.5:3b"
              class="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]" />
          </div>
          <div>
            <label class="block text-sm text-[var(--text)] mb-1">Timeout (ms)</label>
            <input type="number" bind:value={form.llmTimeoutMs}
              class="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]" />
          </div>
          <div class="flex items-center gap-3">
            <button onclick={handleSaveLlm} disabled={isSaving}
              class="px-4 py-2 bg-[var(--accent)] text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50">
              {isSaving ? 'Saving...' : 'Save'}
            </button>
            <button onclick={handleTestLlm} disabled={isTestingLlm}
              class="px-4 py-2 bg-[var(--surface)] border border-[var(--border)] text-sm rounded-lg hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50">
              {isTestingLlm ? 'Testing...' : 'Test connection'}
            </button>
            {#if llmStatusMsg}
              <span class="text-sm {llmStatusOk ? 'text-green-400' : 'text-red-400'}">{llmStatusMsg}</span>
            {/if}
          </div>
        </div>
      </section>
```

- [ ] **Step 4: Run build to verify it passes**

Run: `cd gui && npm run build`
Expected: PASS (Vite production build compiles the Svelte component + api.ts without type errors).

- [ ] **Step 5: Commit**

```bash
git add gui/src/lib/api.ts gui/src/lib/components/SettingsPanel.svelte
git commit -m "feat(llm): add Local LLM settings card to GUI"
```

---

### Task 14: Full `reloadLLM` lifecycle integration test
**Est:** ~1.5h

**Files:**
- Test: `tests/integration/llm.test.ts` (extended from Task 9 — boot → enable → disable → invalid config).

**Interfaces:**
- Consumes: `Omnimind.create`, `omni.setSetting`, `omni.reloadLLM`, `omni.getLLMConfig`, `omni.getLLMStatus`, `omni.llm`.
- Produces: regression coverage for the spec acceptance criteria #7 and #8 (NullProvider on disable; NullProvider + logged warn on invalid non-loopback URL).

- [ ] **Step 1: Extend the failing test (add cases to `tests/integration/llm.test.ts` from Task 9)**

Append the following `it()` blocks inside the existing `describe('reloadLLM surface', ...)` from Task 9 (the file's imports are unchanged except for adding `import { vi } from 'vitest';` and `import type { AddressInfo } from 'node:net';`):

```ts
  it('reloadLLM() with a non-loopback URL falls back to NullProvider', async () => {
    omni.setSetting('llmEnabled', 'true');
    omni.setSetting('llmProvider', 'ollama');
    omni.setSetting('llmBaseUrl', 'https://api.openai.com/v1');
    omni.setSetting('llmModel', 'gpt-4');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await omni.reloadLLM();
    expect(omni.llm.name).toBe('null');
    const status = await omni.getLLMStatus();
    expect(status.configured).toBe(false);
    expect(status.provider).toBe('null');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('getLLMStatus() reports unreachable for a running provider pointed at a closed port', async () => {
    const closed = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: [{ name: 'qwen2.5:3b' }] }));
    });
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));

    omni.setSetting('llmEnabled', 'true');
    omni.setSetting('llmProvider', 'ollama');
    omni.setSetting('llmBaseUrl', `http://127.0.0.1:${closedPort}`);
    omni.setSetting('llmModel', 'qwen2.5:3b');
    await omni.reloadLLM();
    expect(omni.llm.name).toBe('ollama');
    const status = await omni.getLLMStatus();
    expect(status.configured).toBe(true);
    expect(status.reachable).toBe(false);
  });

  it('disable + reloadLLM() returns the tool to the not-configured state', async () => {
    omni.setSetting('llmEnabled', 'true');
    omni.setSetting('llmProvider', 'ollama');
    omni.setSetting('llmModel', 'qwen2.5:3b');
    await omni.reloadLLM();
    expect(omni.llm.name).toBe('ollama');

    omni.setSetting('llmEnabled', 'false');
    await omni.reloadLLM();
    expect(omni.llm.name).toBe('null');
    const status = await omni.getLLMStatus();
    expect(status.configured).toBe(false);
  });
```

- [ ] **Step 2: Run the integration test to verify it fails**

Run: `npx vitest run tests/integration/llm.test.ts`
Expected: If `reloadLLM`'s non-loopback guard or reachable-under-closed-port logic is missing, the new cases fail. If the Task 9 implementation is correct, all cases pass already — that is fine; the value of this task is the permanent regression coverage.

- [ ] **Step 3: Fix/confirm implementation (no new shipping code unless a case is red)**

If any case is red, correct `reloadLLM` (non-loopback → NullProvider + warn) or `getLLMStatus` (reachable probe against the current `_llm`) in `src/index.ts`. No other modules change.

- [ ] **Step 4: Run the full suite to verify it passes**

Run: `npm run typecheck && npx vitest run tests/integration/llm.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/llm.test.ts
git commit -m "test(llm): cover reloadLLM enable/disable/invalid lifecycle"
```

---

### Task 15: Live integration test (gated) — `OMNIMIND_LLM_TEST_LIVE=1`
**Est:** ~0.5h

**Files:**
- Create: `tests/integration/llm-live.test.ts`

**Interfaces:**
- Consumes: `OllamaProvider` (real Ollama at `OMNIMIND_LLM_BASE_URL` or default `http://127.0.0.1:11434`).
- Produces: opt-in smoke that hits a real local LLM when `OMNIMIND_LLM_TEST_LIVE=1`. Skipped by default; not part of coverage thresholds.

- [ ] **Step 1: Write the test**

```ts
// tests/integration/llm-live.test.ts
import { describe, it, expect } from 'vitest';
import { OllamaProvider } from '../../src/core/llm/OllamaProvider.js';

const LIVE = process.env.OMNIMIND_LLM_TEST_LIVE === '1';
const OLLAMA_URL = process.env.OMNIMIND_LLM_BASE_URL ?? 'http://127.0.0.1:11434';

describe.skipIf(!LIVE)('live Ollama (gated by OMNIMIND_LLM_TEST_LIVE=1)', () => {
  it('summarizes a short prompt with non-empty output', async () => {
    const provider = new OllamaProvider({
      provider: 'ollama',
      baseUrl: OLLAMA_URL,
      model: process.env.OMNIMIND_LLM_MODEL ?? 'qwen2.5:3b',
      timeoutMs: 10000,
    });
    const r = await provider.summarize('Hello. Please reply with the single word: ready.', { maxWords: 30 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.trim().length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run (gated) — verify it skips by default and works when enabled**

Run: `npx vitest run tests/integration/llm-live.test.ts`
Expected: PASS/skipped (default, `OMNIMIND_LLM_TEST_LIVE` unset → `describe.skipIf` skips; no fetch happens). With `OMNIMIND_LLM_TEST_LIVE=1` and Ollama running, it should summarize and pass for real.

- [ ] **Step 3: (no implementation)** — the test is the deliverable. Nothing ships beyond the test file.

- [ ] **Step 4: Run typecheck to confirm no unused/typing issues**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/llm-live.test.ts
git commit -m "test(llm): add gated live Ollama integration test"
```

---

### Task 16: Docs — README + USAGE
**Est:** ~0.5h

**Files:**
- Modify: `README.md` — add a "Local LLM (optional)" subsection under features/config.
- Modify: `docs/USAGE.md` — add `config llm` / `summarize` CLI docs and the Settings card.

**Interfaces:** none (docs only).

- [ ] **Step 1: Write the doc snippets**

In `README.md`, add an optional-feature block (e.g. after the "Key capabilities" or in the setup section):
```markdown
### Optional: Local LLM (Ollama / LM Studio) — off by default

Omnimind can plug into a **local** LLM server (Ollama or LM Studio) for an
opt-in **summarization** tool. It is 100% local and **off by default** — fresh
installs never make LLM requests.

- Enable from the **Settings → Local LLM** card (GUI) or the CLI:
  `omnimind config llm enable --provider ollama --model qwen2.5:3b`
- Only the local model is used; the UI refuses any non-loopback URL.
- Summarize text with the MCP tool `omnimind_summarize` or the CLI
  `omnimind summarize "text"`.
- The model must already be running locally; Omnimind never pulls or
  downloads models.
```

In `docs/USAGE.md`, add a CLI section:
```markdown
### Local LLM

- `omnimind config llm status` — show the configured local LLM.
- `omnimind config llm enable --provider ollama|lmstudio [--base-url URL] [--model NAME] [--timeout-ms N]`
  — persist and enable a local LLM.
- `omnimind config llm disable` — disable it.
- `omnimind summarize "<text>" [--max-words N]` — summarize text directly.

Requires Ollama or LM Studio running locally. Off by default; loopback URLs only.
```

- [ ] **Step 2: Verify docs build/link (markdown only)**

Run: `git diff --stat` and `git status`
Expected: only `README.md` and `docs/USAGE.md` staged/changed.

- [ ] **Step 3: (no implementation)** — docs only.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/USAGE.md
git commit -m "docs(llm): document local LLM provider setup and usage"
```

---

## Final Verification (after Task 16, before merge)

Run from repo root:
```bash
npm run typecheck && npm test && npm run lint && npm run build
```
Expected: all green; coverage thresholds (80/80/70/80) met including the new `src/core/llm/*` module. Then `cd gui && npm run build` must pass. Branch is `feat/local-llm-provider` off `dev`; open the PR against `dev`.
