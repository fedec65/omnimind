# Shared Memory Server Client — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collegare il client Omnimind al server MCP remoto di memoria condivisa (team/org) per leggere (`shared_search`), pubblicare (`shared_publish`) e statistiche (`shared_status`), con fallback offline obbligatorio.

**Architecture:** Modulo isolato `src/shared/` con contratto `SharedClient` (`Result<T,E>`, mai throw) e un'unica implementazione `McpSharedClient` basata su `Client` + `StreamableHTTPClientTransport` dell'SDK MCP (transport stateless, Bearer token, protocolVersion 2025-03-26). Il transport è iniettabile per i test. La facade `Omnimind` lo costruisce da settings (`sharedEnabled`/`sharedServerUrl`/`sharedToken`), lo espone come proprietà readonly e appende un blocco `<omnimind_shared>` a `getContextInjection()` con cache 60s. Superfici: 3 tool MCP, comando CLI `shared`, endpoint `/api/shared/test`, sezione GUI impostazioni.

**Tech Stack:** TypeScript 5.5 strict (`exactOptionalPropertyTypes`), `@modelcontextprotocol/sdk` 1.29 (`Client` da `client/index.js`, `StreamableHTTPClientTransport` da `client/streamableHttp.js`), Vitest, Svelte 5 (GUI).

**Spec:** `docs/superpowers/specs/2026-09-21-shared-server-client-design.md`
**Specifica server:** `/Users/federicocesconi/Desktop/omnimind-client-integration.md`

## Global Constraints

- Tutti gli import locali usano estensione `.js` (NodeNext).
- Interfacce con proprietà `readonly`; opzionali come `prop?: Type | undefined`.
- Mai throw per fallimenti attesi: ritornare `Result` (`ok`/`err` da `src/core/types.ts`).
- Chiavi settings esatte: `sharedEnabled` (`'true'`/`'false'`), `sharedServerUrl`, `sharedToken`, `lastSharedError`.
- Retry: solo su 429/5xx/network transitori, backoff esponenziale base 500ms, max 2 retry. **Mai retry su 401** — su 401 segnare `sharedAuthFailed` + setting `lastSharedError` e disattivare la funzionalità condivisa.
- Timeout default 4000ms per chiamata (config `timeoutMs`); nel contesto il blocco shared è omesso silenziosamente su qualsiasi errore.
- Log prefix `[Omnimind]` / `[SharedClient]`.
- Soglie coverage: 80% linee/funzioni, 70% branch (vitest.config.ts). `src/server.ts` e `src/cli.ts` sono esclusi dal coverage ma devono compilare.
- Nome tool MCP esatti: `omnimind_shared_search`, `omnimind_shared_publish`, `omnimind_shared_status`.
- I test non usano `vi.mock` di moduli npm: dipendenze iniettate tramite constructor/config (pattern codebase).
- `shared_search` usa **solo `query_text`** (il server embedda da sé); non passare mai `query_vector`.
- `shared_publish` accetta solo `level` 2|3 (L0/L1 mai).
- Item con `supersededAt != null` esclusi dal blocco contesto.
- Tool remote MCP usati lato client: `shared_search`, `shared_publish`, `shared_status` (nomi esatti dell'endpoint remoto).

---

### Task 1: Tipi e contratto (`src/shared/types.ts`)

**Files:**
- Create: `src/shared/types.ts`

**Interfaces:**
- Produces (usato da Task 2, 3, 5): `SharedErrorKind`, `SharedError`, `SharedClientConfig`, `SharedItem`, `SharedSearchResult`, `SharedStatus`, `SharedPublishInput`, `SharedSuggestion`, `SharedToolTransport`, `SharedClient`. Firme esatte:

```typescript
export interface SharedClient {
  search(queryText: string, limit?: number | undefined): Promise<Result<SharedSearchResult[], SharedError>>;
  publish(input: SharedPublishInput): Promise<Result<string, SharedError>>;
  status(): Promise<Result<SharedStatus, SharedError>>;
  close(): Promise<void>;
}
```

- [ ] **Step 1: Scrivere il file dei tipi**

```typescript
/**
 * Shared memory server — types and contract
 *
 * The shared server is a remote MCP endpoint hosting promoted (L2/L3)
 * team/org memory. This module defines the client contract; the rest of
 * the codebase only sees SharedClient — no HTTP/MCP details leak out.
 */

import type { Result } from '../core/types.js';

// ─── Errors ──────────────────────────────────────────────────────

export type SharedErrorKind = 'unauthorized' | 'rate_limited' | 'server' | 'network' | 'malformed';

export class SharedError extends Error {
  readonly kind: SharedErrorKind;

  constructor(kind: SharedErrorKind, message: string) {
    super(message);
    this.name = 'SharedError';
    this.kind = kind;
  }
}

// ─── Config ──────────────────────────────────────────────────────

export interface SharedClientConfig {
  /** MCP endpoint URL, e.g. https://host/mcp */
  readonly serverUrl: string;
  /** Opaque token (omt_...), sent as Bearer */
  readonly token: string;
  /** Per-call timeout in ms (default 4000) */
  readonly timeoutMs?: number | undefined;
  /** Max retries on transient failures (default 2) */
  readonly maxRetries?: number | undefined;
  /** Base retry delay in ms, doubles per attempt (default 500) */
  readonly retryDelayMs?: number | undefined;
}

// ─── Data ────────────────────────────────────────────────────────

export interface SharedItem {
  readonly id: string;
  readonly content: string;
  readonly level: number;
  readonly visibility: 'team' | 'org';
  readonly metadata: Record<string, unknown>;
  readonly trustWeight: number;
  readonly createdAt: number;
  readonly supersededAt: number | null;
}

export interface SharedSearchResult {
  readonly item: SharedItem;
  readonly score: number;
  readonly matchType: string;
}

export interface SharedStatus {
  readonly items: number;
  readonly superseded: number;
}

export interface SharedPublishInput {
  readonly level: 2 | 3;
  readonly visibility: 'team' | 'org';
  readonly content: string;
  readonly trustWeight?: number | undefined;
  readonly workspaceId?: string | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

/** A local L2/L3 memory the user may want to publish. */
export interface SharedSuggestion {
  readonly memoryId: string;
  readonly content: string;
  readonly level: number;
  readonly suggestedAt: number;
}

// ─── Transport (injectable for tests) ────────────────────────────

/**
 * Lowest-level seam: performs one MCP tools/call and returns the raw
 * tool result. The default implementation speaks StreamableHTTP; tests
 * inject a fake. `reset()` drops any connection state before a retry.
 */
export interface SharedToolTransport {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

// ─── Client contract ─────────────────────────────────────────────

export interface SharedClient {
  search(queryText: string, limit?: number | undefined): Promise<Result<SharedSearchResult[], SharedError>>;
  publish(input: SharedPublishInput): Promise<Result<string, SharedError>>;
  status(): Promise<Result<SharedStatus, SharedError>>;
  close(): Promise<void>;
}
```

- [ ] **Step 2: Verificare typecheck**

Run: `npm run typecheck`
Expected: pass (no errori su tipi inutilizzati: `SharedClient` ecc. sono export, `noUnusedLocals` non si applica agli export).

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(shared): types and contract for shared memory server client"
```

---

### Task 2: `McpSharedClient` — implementazione MCP con retry/backoff/timeout

**Files:**
- Create: `src/shared/McpSharedClient.ts`
- Test: `tests/shared/McpSharedClient.test.ts`

**Interfaces:**
- Consumes (Task 1): `SharedClient`, `SharedClientConfig`, `SharedError`, `SharedErrorKind`, `SharedPublishInput`, `SharedSearchResult`, `SharedStatus`, `SharedToolTransport`; `Result`/`ok`/`err` da `src/core/types.ts`.
- Produces (Task 3, 7): `export class McpSharedClient implements SharedClient` con `constructor(config: SharedClientConfig, transport?: SharedToolTransport)`. Metodi: `search(queryText, limit?)`, `publish(input)`, `status()`, `close()`.

- [ ] **Step 1: Scrivere il test (fake transport)**

```typescript
/**
 * Unit tests for McpSharedClient against an injected fake transport.
 * No network, no vi.mock — the transport is the seam.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { McpSharedClient } from '../../src/shared/McpSharedClient.js';
import {
  SharedError,
  type SharedToolTransport,
  type SharedClientConfig,
} from '../../src/shared/types.js';

class FakeTransport implements SharedToolTransport {
  calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  resets = 0;
  private queue: Array<() => Promise<unknown>> = [];

  enqueueText(text: string): void {
    this.queue.push(async () => ({ content: [{ type: 'text', text }] }));
  }

  enqueueRaw(raw: unknown): void {
    this.queue.push(async () => raw);
  }

  enqueueThrow(error: unknown): void {
    this.queue.push(async () => {
      throw error;
    });
  }

  enqueueToolError(text: string): void {
    this.queue.push(async () => ({ content: [{ type: 'text', text }], isError: true }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ name, args });
    const next = this.queue.shift();
    if (!next) throw new Error('FakeTransport: no queued response');
    return next();
  }

  async reset(): Promise<void> {
    this.resets++;
  }

  async close(): Promise<void> {}
}

const CONFIG: SharedClientConfig = {
  serverUrl: 'https://example.invalid/mcp',
  token: 'omt_testtoken',
  retryDelayMs: 1,
};

function searchPayload(): string {
  return JSON.stringify([
    {
      item: {
        id: 'item-1',
        content: 'Shared decision: use Postgres',
        level: 2,
        visibility: 'org',
        metadata: { source: 'doc' },
        trustWeight: 0.8,
        createdAt: 1720000000000,
        supersededAt: null,
      },
      score: 0.91,
      matchType: 'hybrid',
    },
  ]);
}

describe('McpSharedClient', () => {
  let transport: FakeTransport;
  let client: McpSharedClient;

  beforeEach(() => {
    transport = new FakeTransport();
    client = new McpSharedClient(CONFIG, transport);
  });

  it('search sends shared_search with query_text and parses results', async () => {
    transport.enqueueText(searchPayload());

    const result = await client.search('postgres decision', 5);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBe(1);
    expect(result.value[0]!.item.id).toBe('item-1');
    expect(result.value[0]!.item.visibility).toBe('org');
    expect(result.value[0]!.score).toBe(0.91);
    expect(transport.calls[0]!.name).toBe('shared_search');
    expect(transport.calls[0]!.args).toEqual({ query_text: 'postgres decision', limit: 5 });
  });

  it('search omits limit when not given', async () => {
    transport.enqueueText('[]');

    const result = await client.search('anything');

    expect(result.ok).toBe(true);
    expect(transport.calls[0]!.args).toEqual({ query_text: 'anything' });
  });

  it('search skips malformed entries but keeps valid ones', async () => {
    transport.enqueueText(
      JSON.stringify([
        { item: { content: 'no id here' }, score: 0.5 },
        {
          item: { id: 'ok', content: 'valid', level: 3, visibility: 'team', trustWeight: 0.5, createdAt: 1, supersededAt: null },
          score: 0.7,
        },
      ]),
    );

    const result = await client.search('q');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBe(1);
    expect(result.value[0]!.item.id).toBe('ok');
  });

  it('search maps non-array payload to malformed error', async () => {
    transport.enqueueText('{"unexpected": true}');

    const result = await client.search('q');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('malformed');
  });

  it('publish sends shared_publish with mapped args and returns id', async () => {
    transport.enqueueText(JSON.stringify({ id: 'uuid-123' }));

    const result = await client.publish({
      level: 2,
      visibility: 'team',
      content: 'concept text',
      trustWeight: 0.7,
      workspaceId: 'ws-1',
      metadata: { origin: 'local' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe('uuid-123');
    expect(transport.calls[0]!.name).toBe('shared_publish');
    expect(transport.calls[0]!.args).toEqual({
      level: 2,
      visibility: 'team',
      content: 'concept text',
      trust_weight: 0.7,
      workspace_id: 'ws-1',
      metadata: { origin: 'local' },
    });
  });

  it('publish without optional args sends only required fields', async () => {
    transport.enqueueText(JSON.stringify({ id: 'uuid-9' }));

    await client.publish({ level: 3, visibility: 'org', content: 'wisdom' });

    expect(transport.calls[0]!.args).toEqual({ level: 3, visibility: 'org', content: 'wisdom' });
  });

  it('status parses items and superseded', async () => {
    transport.enqueueText(JSON.stringify({ status: 'ok', items: 42, superseded: 7 }));

    const result = await client.status();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ items: 42, superseded: 7 });
    expect(transport.calls[0]!.name).toBe('shared_status');
  });

  it('retries on rate_limit (429) then succeeds', async () => {
    transport.enqueueThrow(new SharedError('rate_limited', '429'));
    transport.enqueueText(searchPayload());

    const result = await client.search('q');

    expect(result.ok).toBe(true);
    expect(transport.calls.length).toBe(2);
    expect(transport.resets).toBe(1);
  });

  it('retries on 5xx then gives up after maxRetries', async () => {
    transport.enqueueThrow(new SharedError('server', '500'));
    transport.enqueueThrow(new SharedError('server', '502'));
    transport.enqueueThrow(new SharedError('server', '503'));

    const result = await client.search('q');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('server');
    expect(transport.calls.length).toBe(3); // 1 + 2 retries
    expect(transport.resets).toBe(2);
  });

  it('does NOT retry on unauthorized (401)', async () => {
    transport.enqueueThrow(new SharedError('unauthorized', 'token revoked'));

    const result = await client.search('q');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unauthorized');
    expect(transport.calls.length).toBe(1);
    expect(transport.resets).toBe(0);
  });

  it('classifies raw thrown errors by code/message', async () => {
    transport.enqueueThrow(Object.assign(new Error('HTTP 401'), { code: 401 }));

    const result = await client.status();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unauthorized');
  });

  it('maps isError tool results to server error and retries', async () => {
    transport.enqueueToolError('internal boom');
    transport.enqueueToolError('internal boom');
    transport.enqueueToolError('internal boom');

    const result = await client.status();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('server');
    expect(transport.calls.length).toBe(3);
  });

  it('maps invalid JSON to malformed error without retry', async () => {
    transport.enqueueText('not json{');

    const result = await client.status();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('malformed');
    expect(transport.calls.length).toBe(1);
  });

  it('maps missing text content to malformed error', async () => {
    transport.enqueueRaw({ content: [] });

    const result = await client.status();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('malformed');
  });

  it('times out a hanging call as network error', async () => {
    const slow: SharedToolTransport = {
      async callTool() {
        await new Promise((r) => setTimeout(r, 200));
        return { content: [{ type: 'text', text: '[]' }] };
      },
      async reset() {},
      async close() {},
    };
    const impatient = new McpSharedClient({ ...CONFIG, timeoutMs: 20, retryDelayMs: 1, maxRetries: 0 }, slow);

    const result = await impatient.search('q');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('network');
  });
});
```

- [ ] **Step 2: Verificare che il test fallisca**

Run: `npx vitest run tests/shared/McpSharedClient.test.ts`
Expected: FAIL — `Cannot find module '../../src/shared/McpSharedClient.js'`.

- [ ] **Step 3: Implementare `McpSharedClient`**

```typescript
/**
 * McpSharedClient — SharedClient verso il server MCP di memoria condivisa.
 *
 * Transport stateless (StreamableHTTP): ogni POST è indipendente, nessun
 * Mcp-Session-Id. Auth via header Authorization: Bearer <omt_...>.
 * protocolVersion negoziato: 2025-03-26.
 *
 * Resilienza (requisiti PRD):
 * - retry solo su 429/5xx/network transitori, backoff esponenziale, max 2
 * - MAI retry su 401
 * - timeout per chiamata (default 4s)
 * - il chiamante (facade) tratta ogni errore come fallback solo-locale
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { type Result, ok, err } from '../core/types.js';
import {
  SharedError,
  type SharedClient,
  type SharedClientConfig,
  type SharedErrorKind,
  type SharedPublishInput,
  type SharedSearchResult,
  type SharedStatus,
  type SharedToolTransport,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 500;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Transport reale: MCP StreamableHTTP stateless verso il server condiviso. */
class McpToolTransport implements SharedToolTransport {
  private readonly url: string;
  private readonly token: string;
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  private async ensureConnected(): Promise<Client> {
    if (this.client) return this.client;
    const transport = new StreamableHTTPClientTransport(new URL(this.url), {
      requestInit: {
        headers: { Authorization: `Bearer ${this.token}` },
      },
    });
    // protocolVersion 2025-03-26 comes from the SDK's default negotiation
    // range; the remote server pins it during initialize.
    const client = new Client({ name: 'omnimind-shared-client', version: '0.1.0' });
    await client.connect(transport);
    this.transport = transport;
    this.client = client;
    return client;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const client = await this.ensureConnected();
    return client.callTool({ name, arguments: args });
  }

  async reset(): Promise<void> {
    const client = this.client;
    const transport = this.transport;
    this.client = null;
    this.transport = null;
    if (client) await client.close().catch(() => {});
    else if (transport) await transport.close().catch(() => {});
  }

  async close(): Promise<void> {
    await this.reset();
  }
}

/** Classifica un errore grezzo (SDK o transport) in SharedError. */
function classifyError(error: unknown): SharedError {
  if (error instanceof SharedError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (code === 401 || /unauthorized|401/i.test(message)) {
    return new SharedError('unauthorized', 'unauthorized — token revoked or invalid');
  }
  if (code === 429) return new SharedError('rate_limited', 'rate limited (100 req/min per token)');
  if (typeof code === 'number' && code >= 500) return new SharedError('server', `server error ${code}`);
  return new SharedError('network', message);
}

export class McpSharedClient implements SharedClient {
  private readonly config: Required<Omit<SharedClientConfig, 'timeoutMs' | 'maxRetries' | 'retryDelayMs'>> &
    Pick<SharedClientConfig, 'timeoutMs' | 'maxRetries' | 'retryDelayMs'>;
  private readonly transport: SharedToolTransport;

  constructor(config: SharedClientConfig, transport?: SharedToolTransport) {
    this.config = {
      serverUrl: config.serverUrl,
      token: config.token,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
      retryDelayMs: config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
    };
    this.transport = transport ?? new McpToolTransport(config.serverUrl, config.token);
  }

  search(queryText: string, limit?: number | undefined): Promise<Result<SharedSearchResult[], SharedError>> {
    const args: Record<string, unknown> = { query_text: queryText };
    if (limit !== undefined) args.limit = limit;
    return this.callWithRetry('shared_search', args, (text) => this.parseSearch(text));
  }

  publish(input: SharedPublishInput): Promise<Result<string, SharedError>> {
    const args: Record<string, unknown> = {
      level: input.level,
      visibility: input.visibility,
      content: input.content,
    };
    if (input.trustWeight !== undefined) args.trust_weight = input.trustWeight;
    if (input.workspaceId !== undefined) args.workspace_id = input.workspaceId;
    if (input.metadata !== undefined) args.metadata = input.metadata;
    return this.callWithRetry('shared_publish', args, (text) => {
      try {
        const parsed = JSON.parse(text) as { id?: unknown };
        if (typeof parsed?.id !== 'string') {
          return err(new SharedError('malformed', 'shared_publish result missing id'));
        }
        return ok(parsed.id);
      } catch {
        return err(new SharedError('malformed', 'invalid JSON in shared_publish result'));
      }
    });
  }

  status(): Promise<Result<SharedStatus, SharedError>> {
    return this.callWithRetry('shared_status', {}, (text) => {
      try {
        const parsed = JSON.parse(text) as { items?: unknown; superseded?: unknown };
        if (typeof parsed?.items !== 'number') {
          return err(new SharedError('malformed', 'shared_status result missing items'));
        }
        return ok({
          items: parsed.items,
          superseded: typeof parsed.superseded === 'number' ? parsed.superseded : 0,
        });
      } catch {
        return err(new SharedError('malformed', 'invalid JSON in shared_status result'));
      }
    });
  }

  async close(): Promise<void> {
    await this.transport.close().catch(() => {});
  }

  // ─── Internals ────────────────────────────────────────────────

  private async withTimeout(promise: Promise<unknown>): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new SharedError('network', `timeout after ${this.config.timeoutMs}ms`)),
            this.config.timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async callWithRetry<T>(
    name: string,
    args: Record<string, unknown>,
    parse: (text: string) => Result<T, SharedError>,
  ): Promise<Result<T, SharedError>> {
    let attempt = 0;
    for (;;) {
      try {
        const raw = await this.withTimeout(this.transport.callTool(name, args));
        const textResult = extractText(raw);
        if (!textResult.ok) {
          // isError tool results are retryable server failures
          if (textResult.error.kind === 'server' && attempt < this.config.maxRetries) {
            attempt++;
            await delay(this.config.retryDelayMs * 2 ** (attempt - 1));
            await this.transport.reset().catch(() => {});
            continue;
          }
          return textResult;
        }
        return parse(textResult.value);
      } catch (error) {
        const sharedError = classifyError(error);
        const retryable =
          sharedError.kind === 'rate_limited' || sharedError.kind === 'server' || sharedError.kind === 'network';
        if (retryable && attempt < this.config.maxRetries) {
          attempt++;
          await delay(this.config.retryDelayMs * 2 ** (attempt - 1));
          await this.transport.reset().catch(() => {});
          continue;
        }
        return err(sharedError);
      }
    }
  }

  private parseSearch(text: string): Result<SharedSearchResult[], SharedError> {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!Array.isArray(parsed)) {
        return err(new SharedError('malformed', 'shared_search returned non-array payload'));
      }
      const results: SharedSearchResult[] = [];
      for (const entry of parsed) {
        const r = entry as {
          item?: {
            id?: unknown;
            content?: unknown;
            level?: unknown;
            visibility?: unknown;
            metadata?: unknown;
            trustWeight?: unknown;
            createdAt?: unknown;
            supersededAt?: unknown;
          };
          score?: unknown;
          matchType?: unknown;
        };
        if (typeof r?.item?.id !== 'string' || typeof r.item.content !== 'string') continue;
        results.push({
          item: {
            id: r.item.id,
            content: r.item.content,
            level: typeof r.item.level === 'number' ? r.item.level : 0,
            visibility: r.item.visibility === 'team' ? 'team' : 'org',
            metadata: (r.item.metadata ?? {}) as Record<string, unknown>,
            trustWeight: typeof r.item.trustWeight === 'number' ? r.item.trustWeight : 0.5,
            createdAt: typeof r.item.createdAt === 'number' ? r.item.createdAt : 0,
            supersededAt: typeof r.item.supersededAt === 'number' ? r.item.supersededAt : null,
          },
          score: typeof r.score === 'number' ? r.score : 0,
          matchType: typeof r.matchType === 'string' ? r.matchType : 'hybrid',
        });
      }
      return ok(results);
    } catch {
      return err(new SharedError('malformed', 'invalid JSON in shared_search result'));
    }
  }
}

/** Estrae il primo content item di tipo text dal risultato grezzo del tool. */
function extractText(raw: unknown): Result<string, SharedError> {
  const result = raw as {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  } | null;
  if (result?.isError) {
    const detail = result.content?.find((c) => c.type === 'text')?.text ?? 'unknown tool error';
    return err(new SharedError('server', `tool error: ${detail}`));
  }
  const text = result?.content?.find((c) => c.type === 'text')?.text;
  if (typeof text !== 'string') {
    return err(new SharedError('malformed', 'tool result has no text content'));
  }
  return ok(text);
}
```

- [ ] **Step 4: Verificare che i test passino**

Run: `npx vitest run tests/shared/McpSharedClient.test.ts`
Expected: PASS (16 test).

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/shared/McpSharedClient.ts tests/shared/McpSharedClient.test.ts
git commit -m "feat(shared): McpSharedClient with retry/backoff/timeout over StreamableHTTP"
```

---

### Task 3: Wiring facade (`src/index.ts`) — client da settings, suggestions, publish

**Files:**
- Modify: `src/index.ts` (imports; `OmnimindConfig`; constructor; `create()`; nuovi metodi; hook in `checkAging`)
- Test: `tests/shared/SharedFacade.test.ts`

**Interfaces:**
- Consumes (Task 2): `McpSharedClient`, `SharedClient`, `SharedToolTransport`, `SharedError`, `SharedSuggestion`, `SharedPublishInput`.
- Produces (usato da Task 4, 5, 6):
  - `OmnimindConfig.sharedTransport?: SharedToolTransport | undefined`
  - `readonly shared: SharedClient | null`
  - `sharedAvailable(): boolean`
  - `getSharedSuggestions(): SharedSuggestion[]`
  - `publishMemoryToShared(id: string, opts: { visibility: 'team' | 'org'; workspaceId?: string | undefined; trustWeight?: number | undefined }): Promise<Result<string, Error>>`
  - privato `handleSharedError(error: SharedError): void` — su 401 setta `sharedAuthFailed = true` + setting `lastSharedError`.

- [ ] **Step 1: Scrivere il test facade**

```typescript
/**
 * Facade wiring tests: settings-driven construction, suggestions,
 * publishMemoryToShared, 401 handling. Uses an injected fake transport
 * (no network).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Omnimind } from '../../src/index.js';
import { SharedError, type SharedToolTransport } from '../../src/shared/types.js';

class FakeTransport implements SharedToolTransport {
  calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  private queue: Array<() => Promise<unknown>> = [];
  enqueueText(text: string): void {
    this.queue.push(async () => ({ content: [{ type: 'text', text }] }));
  }
  enqueueThrow(error: unknown): void {
    this.queue.push(async () => {
      throw error;
    });
  }
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ name, args });
    const next = this.queue.shift();
    if (!next) throw new Error('FakeTransport: no queued response');
    return next();
  }
  async reset(): Promise<void> {}
  async close(): Promise<void> {}
}

const SEARCH_PAYLOAD = JSON.stringify([
  {
    item: {
      id: 's1',
      content: 'Org-wide decision: monorepo',
      level: 3,
      visibility: 'org',
      metadata: {},
      trustWeight: 0.9,
      createdAt: 1,
      supersededAt: null,
    },
    score: 0.88,
    matchType: 'hybrid',
  },
  {
    item: {
      id: 's2',
      content: 'Old superseded item',
      level: 2,
      visibility: 'org',
      metadata: {},
      trustWeight: 0.5,
      createdAt: 1,
      supersededAt: 1720000000000,
    },
    score: 0.5,
    matchType: 'hybrid',
  },
]);

describe('Omnimind facade — shared server wiring', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omnimind-shared-facade-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the shared client when settings are enabled+configured', async () => {
    const omni = await Omnimind.create({ dataDir: tmpDir, adapters: false });
    omni.setSetting('sharedEnabled', 'true');
    omni.setSetting('sharedServerUrl', 'https://example.invalid/mcp');
    omni.setSetting('sharedToken', 'omt_abc');
    await omni.close();

    const omni2 = await Omnimind.create({ dataDir: tmpDir, adapters: false });
    expect(omni2.shared).not.toBeNull();
    expect(omni2.sharedAvailable()).toBe(true);
    await omni2.close();
  });

  it('does not create the shared client when disabled or missing config', async () => {
    const omni = await Omnimind.create({ dataDir: tmpDir, adapters: false });
    expect(omni.shared).toBeNull();
    expect(omni.sharedAvailable()).toBe(false);
    await omni.close();
  });

  it('uses the injected transport regardless of settings', async () => {
    const fake = new FakeTransport();
    fake.enqueueText('{"status":"ok","items":3,"superseded":0}');
    const omni = await Omnimind.create({ dataDir: tmpDir, adapters: false, sharedTransport: fake });
    expect(omni.shared).not.toBeNull();

    const status = await omni.shared!.status();
    expect(status.ok).toBe(true);
    expect(fake.calls[0]!.name).toBe('shared_status');
    await omni.close();
  });

  it('publishMemoryToShared fetches the local memory and publishes its content', async () => {
    const fake = new FakeTransport();
    fake.enqueueText('{"id":"published-1"}');
    const omni = await Omnimind.create({ dataDir: tmpDir, adapters: false, sharedTransport: fake });

    const stored = await omni.store('Concept about testing strategy', { wing: 'eng' });
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;

    // Force the memory to L2 (as the aging pipeline would)
    const updated = await omni.memoryStore.update(stored.value.id, { layer: 2 });
    expect(updated.ok).toBe(true);

    const result = await omni.publishMemoryToShared(stored.value.id, { visibility: 'org' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe('published-1');
    expect(fake.calls[0]!.args).toMatchObject({ level: 2, visibility: 'org', content: 'Concept about testing strategy' });
    await omni.close();
  });

  it('publishMemoryToShared rejects L0 memories', async () => {
    const fake = new FakeTransport();
    const omni = await Omnimind.create({ dataDir: tmpDir, adapters: false, sharedTransport: fake });

    const stored = await omni.store('Fresh verbatim memory', { wing: 'eng' });
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;

    const result = await omni.publishMemoryToShared(stored.value.id, { visibility: 'org' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('L2/L3');
    expect(fake.calls.length).toBe(0);
    await omni.close();
  });

  it('tracks suggestions with cap and TTL', async () => {
    const fake = new FakeTransport();
    const omni = await Omnimind.create({ dataDir: tmpDir, adapters: false, sharedTransport: fake });
    expect(omni.getSharedSuggestions().length).toBe(0);

    const stored = await omni.store('Promoted concept', { wing: 'eng' });
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    const updated = await omni.memoryStore.update(stored.value.id, { layer: 2 });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;

    (omni as any).noteSharedSuggestion(updated.value);
    expect(omni.getSharedSuggestions().length).toBe(1);
    expect(omni.getSharedSuggestions()[0]!.memoryId).toBe(stored.value.id);

    // Cap at 20
    for (let i = 0; i < 25; i++) {
      (omni as any).noteSharedSuggestion({ ...updated.value, id: `m${i}`, layer: 2 });
    }
    expect(omni.getSharedSuggestions().length).toBe(20);

    // TTL: a 25h-old suggestion disappears
    const old = { ...updated.value, id: 'old-one', layer: 2 as const };
    (omni as any).noteSharedSuggestion(old);
    const list = (omni as any).sharedSuggestions as Array<{ memoryId: string; suggestedAt: number }>;
    const entry = list.find((s) => s.memoryId === 'old-one');
    expect(entry).toBeDefined();
    entry!.suggestedAt = Date.now() - 25 * 60 * 60 * 1000;
    expect(omni.getSharedSuggestions().find((s) => s.memoryId === 'old-one')).toBeUndefined();
    await omni.close();
  });

  it('401 disables shared functionality and records lastSharedError', async () => {
    const fake = new FakeTransport();
    fake.enqueueThrow(new SharedError('unauthorized', 'revoked'));
    const omni = await Omnimind.create({ dataDir: tmpDir, adapters: false, sharedTransport: fake });
    expect(omni.sharedAvailable()).toBe(true);

    const result = await omni.shared!.search('q');
    expect(result.ok).toBe(false);

    // The facade observes the error via publishMemoryToShared/handleSharedError;
    // a direct client call bypasses it, so exercise the public path:
    const pub = await omni.publishMemoryToShared('nonexistent', { visibility: 'org' });
    expect(pub.ok).toBe(false);
    await omni.close();
  });
});
```

Nota sull'ultimo test: `omni.shared!.search()` diretto non passa da `handleSharedError`. Il wiring reale della gestione 401 avviene in `getContextInjection`/`publishMemoryToShared` (Task 4 copre il contesto). Per rendere il test deterministico sul path pubblico, sostituire il corpo finale con:

```typescript
  it('401 via publishMemoryToShared disables shared functionality and records lastSharedError', async () => {
    const fake = new FakeTransport();
    fake.enqueueThrow(new SharedError('unauthorized', 'revoked'));
    fake.enqueueThrow(new SharedError('unauthorized', 'revoked'));
    fake.enqueueThrow(new SharedError('unauthorized', 'revoked'));
    const omni = await Omnimind.create({ dataDir: tmpDir, adapters: false, sharedTransport: fake });

    const stored = await omni.store('Concept', { wing: 'eng' });
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    await omni.memoryStore.update(stored.value.id, { layer: 2 });

    expect(omni.sharedAvailable()).toBe(true);
    const pub = await omni.publishMemoryToShared(stored.value.id, { visibility: 'org' });
    expect(pub.ok).toBe(false);
    expect(omni.sharedAvailable()).toBe(false);

    const last = omni.getSetting('lastSharedError');
    expect(last.ok).toBe(true);
    expect(last.value).toContain('unauthorized');
    await omni.close();
  });
```

(e rimuovere il test `'401 disables shared functionality and records lastSharedError'` originale).

- [ ] **Step 2: Verificare che il test fallisca**

Run: `npx vitest run tests/shared/SharedFacade.test.ts`
Expected: FAIL — `sharedTransport` non esiste in `OmnimindConfig`, `omni.shared`/`sharedAvailable`/`getSharedSuggestions`/`publishMemoryToShared` non esistono (errori TS/vitest).

- [ ] **Step 3: Implementare il wiring in `src/index.ts`**

Modifiche puntuali:

**(a) Aggiungere import** — dopo gli import da `./prediction/IntentPredictor.js` (riga 74):

```typescript
import { McpSharedClient } from './shared/McpSharedClient.js';
import type { SharedClient, SharedError, SharedSuggestion, SharedToolTransport } from './shared/types.js';
```

E nell'import da `./core/types.js` aggiungere `TimeConstants` alla lista dei named import (riga 53-71).

**(b) Aggiungere a `OmnimindConfig`** (dopo `nerEngine`, prima di `onProgress`):

```typescript
  /**
   * Injectable transport for the shared memory server client (tests).
   * When provided, a SharedClient is always created regardless of the
   * sharedEnabled/sharedServerUrl/sharedToken settings.
   */
  sharedTransport?: SharedToolTransport | undefined;
```

**(c) Aggiungere campo alla classe** — dopo `readonly contextInjector: ContextInjector;` (riga 110):

```typescript
  readonly shared: SharedClient | null;
  private sharedAuthFailed = false;
  private sharedSuggestions: SharedSuggestion[] = [];
```

**(d) Costruttore** — aggiungere parametro `shared: SharedClient | null` in coda agli attuali e assegnare `this.shared = shared;`. La firma diventa:

```typescript
  private constructor(
    store: MemoryStore,
    bus: MemoryBus,
    predictor: IntentPredictor,
    patternStore: PatternStore,
    activityTracker: ActivityTracker,
    contextInjector: ContextInjector,
    shared: SharedClient | null,
  ) {
```

e l'invocazione in `create()` (riga 214) diventa `new Omnimind(store, bus, predictor, patternStore, activityTracker, contextInjector, shared)`.

**(e) Costruzione in `create()`** — inserire subito prima di `const omni = new Omnimind(...)` (riga 214):

```typescript
    // ─── Shared memory server (optional, best-effort) ───────────
    // The shared server is a remote MCP endpoint hosting promoted
    // (L2/L3) team/org memory. If unreachable or unauthorized, the
    // client keeps working local-only — never the other way around.
    let shared: SharedClient | null = null;
    if (config.sharedTransport) {
      shared = new McpSharedClient({ serverUrl: '', token: '' }, config.sharedTransport);
    } else {
      const sharedEnabled = store.getSetting('sharedEnabled');
      const sharedUrl = store.getSetting('sharedServerUrl');
      const sharedToken = store.getSetting('sharedToken');
      if (
        sharedEnabled.ok && sharedEnabled.value === 'true' &&
        sharedUrl.ok && sharedUrl.value !== null && sharedUrl.value.length > 0 &&
        sharedToken.ok && sharedToken.value !== null && sharedToken.value.length > 0
      ) {
        try {
          shared = new McpSharedClient({ serverUrl: sharedUrl.value, token: sharedToken.value });
        } catch (error) {
          console.error(`[Omnimind] Shared client failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
```

**(f) Hook suggestions in `checkAging`** — subito prima di `console.log(`[Omnimind] Aged memory ...` (riga 489):

```typescript
    // Promotion to L2/L3: suggest publishing to the shared server
    if (updateResult.ok && aged.layer >= MemoryLayer.Concept && aged.layer !== memory.layer) {
      this.noteSharedSuggestion(aged);
    }
```

**(g) Nuovi metodi pubblici/privati** — nella sezione `// ─── Settings ───` (dopo `setSetting`, riga 753), aggiungere:

```typescript
  // ─── Shared Memory Server ────────────────────────────────────────

  /** True when the shared server client is configured and authenticated. */
  sharedAvailable(): boolean {
    return this.shared !== null && !this.sharedAuthFailed;
  }

  /** Local L2/L3 memories pending a publish decision (max 20, 24h TTL). */
  getSharedSuggestions(): SharedSuggestion[] {
    const cutoff = Date.now() - TimeConstants.DAY;
    return this.sharedSuggestions.filter((s) => s.suggestedAt >= cutoff);
  }

  /**
   * Publish a local L2/L3 memory to the shared server.
   * Explicit user action — content leaves this machine.
   */
  async publishMemoryToShared(
    id: string,
    opts: {
      visibility: 'team' | 'org';
      workspaceId?: string | undefined;
      trustWeight?: number | undefined;
    },
  ): Promise<Result<string, Error>> {
    if (!this.shared || this.sharedAuthFailed) {
      return err(new Error('Shared memory server not configured'));
    }
    const mem = await this.memoryStore.get(id);
    if (!mem.ok) return err(mem.error);
    if (!mem.value) return err(new Error(`Memory not found: ${id}`));

    const memory = mem.value;
    if (memory.layer !== MemoryLayer.Concept && memory.layer !== MemoryLayer.Wisdom) {
      return err(new Error(`Only L2/L3 memories can be published (memory is L${memory.layer})`));
    }

    const result = await this.shared.publish({
      level: memory.layer,
      visibility: opts.visibility,
      content: memory.content,
      ...(opts.workspaceId !== undefined ? { workspaceId: opts.workspaceId } : {}),
      ...(opts.trustWeight !== undefined ? { trustWeight: opts.trustWeight } : {}),
    });
    if (!result.ok) {
      this.handleSharedError(result.error);
      return err(result.error);
    }
    this.sharedSuggestions = this.sharedSuggestions.filter((s) => s.memoryId !== id);
    return ok(result.value);
  }

  /** Record a publish suggestion for a freshly promoted L2/L3 memory. */
  private noteSharedSuggestion(memory: Memory): void {
    if (this.shared === null) return;
    this.sharedSuggestions = this.sharedSuggestions.filter((s) => s.memoryId !== memory.id);
    this.sharedSuggestions.unshift({
      memoryId: memory.id,
      content: memory.content,
      level: memory.layer,
      suggestedAt: Date.now(),
    });
    if (this.sharedSuggestions.length > 20) this.sharedSuggestions.length = 20;
  }

  /** 401 → disable shared functionality until the user renews the token. */
  private handleSharedError(error: SharedError): void {
    if (error.kind !== 'unauthorized') return;
    this.sharedAuthFailed = true;
    this.setSetting('lastSharedError', `unauthorized:${Date.now()}`);
    console.error(
      '[Omnimind] Shared server unauthorized — token revoked or invalid. ' +
      'Update it with: omnimind shared config --token <new-token>',
    );
  }
```

- [ ] **Step 4: Verificare che i test passino**

Run: `npx vitest run tests/shared/SharedFacade.test.ts`
Expected: PASS (7 test).

- [ ] **Step 5: Typecheck + lint + suite completa**

Run: `npm run typecheck && npm run lint && npm test`
Expected: pass (la suite esistente non deve regredire: `checkAging` ha un hook in più ma comportamento identico senza client condiviso).

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/shared/SharedFacade.test.ts
git commit -m "feat(shared): facade wiring — settings-driven client, suggestions, publish"
```

---

### Task 4: Blocco `<omnimind_shared>` in `getContextInjection()`

**Files:**
- Modify: `src/index.ts` (`getContextInjection` riga 701-706; nuovo `buildSharedContextBlock` privato; campo `sharedCache`)
- Test: `tests/shared/SharedContext.test.ts`

**Interfaces:**
- Consumes (Task 3): `this.shared`, `sharedAvailable()`, `getSharedSuggestions()`, `handleSharedError()`.
- Produces: `getContextInjection()` ritorna injection locale + blocco shared (quando disponibile); cache in memoria TTL 60s chiave fingerprint.

- [ ] **Step 1: Scrivere il test**

```typescript
/**
 * Tests for the <omnimind_shared> context block: formatting, superseded
 * filtering, suggestions, cache TTL, silent omission on errors.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Omnimind } from '../../src/index.js';
import { SharedError, type SharedToolTransport } from '../../src/shared/types.js';

class FakeTransport implements SharedToolTransport {
  calls = 0;
  failNext = 0;
  private queue: Array<() => Promise<unknown>> = [];
  enqueueText(text: string): void {
    this.queue.push(async () => ({ content: [{ type: 'text', text }] }));
  }
  async callTool(): Promise<unknown> {
    this.calls++;
    if (this.failNext > 0) {
      this.failNext--;
      throw new SharedError('network', 'down');
    }
    const next = this.queue.shift();
    if (!next) throw new Error('FakeTransport: no queued response');
    return next();
  }
  async reset(): Promise<void> {}
  async close(): Promise<void> {}
}

const RESULT = (id: string, content: string, supersededAt: number | null = null) => ({
  item: {
    id,
    content,
    level: 2,
    visibility: 'org',
    metadata: {},
    trustWeight: 0.5,
    createdAt: 1,
    supersededAt,
  },
  score: 0.9,
  matchType: 'hybrid',
});

describe('getContextInjection — omnimind_shared block', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omnimind-shared-ctx-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('appends <omnimind_shared> with results, filtering superseded items', async () => {
    const fake = new FakeTransport();
    fake.enqueueText(JSON.stringify([RESULT('a', 'Active shared memory'), RESULT('b', 'Superseded one', 1720000000000)]));
    const omni = await Omnimind.create({ dataDir: tmpDir, adapters: false, sharedTransport: fake });

    const injection = await omni.getContextInjection();
    expect(injection.ok).toBe(true);
    if (!injection.ok) return;
    expect(injection.value).toContain('<omnimind_shared');
    expect(injection.value).toContain('Active shared memory');
    expect(injection.value).not.toContain('Superseded one');
    await omni.close();
  });

  it('omits the block silently when the shared server errors', async () => {
    const fake = new FakeTransport();
    fake.failNext = 3; // exhaust retries
    const omni = await Omnimind.create({ dataDir: tmpDir, adapters: false, sharedTransport: fake });

    const injection = await omni.getContextInjection();
    expect(injection.ok).toBe(true);
    if (!injection.ok) return;
    expect(injection.value).not.toContain('<omnimind_shared');
    await omni.close();
  });

  it('omits the block when no shared client is configured', async () => {
    const omni = await Omnimind.create({ dataDir: tmpDir, adapters: false });

    const injection = await omni.getContextInjection();
    expect(injection.ok).toBe(true);
    if (!injection.ok) return;
    expect(injection.value).not.toContain('<omnimind_shared');
    await omni.close();
  });

  it('includes pending suggestions as shared_suggestion lines', async () => {
    const fake = new FakeTransport();
    const omni = await Omnimind.create({ dataDir: tmpDir, adapters: false, sharedTransport: fake });

    const stored = await omni.store('Freshly promoted concept worth sharing', { wing: 'eng' });
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    const updated = await omni.memoryStore.update(stored.value.id, { layer: 2 });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    (omni as any).noteSharedSuggestion(updated.value);

    const injection = await omni.getContextInjection();
    expect(injection.ok).toBe(true);
    if (!injection.ok) return;
    expect(injection.value).toContain('shared_suggestion');
    expect(injection.value).toContain('Freshly promoted concept worth sharing');
    await omni.close();
  });

  it('caches results for 60s per fingerprint', async () => {
    const fake = new FakeTransport();
    fake.enqueueText(JSON.stringify([RESULT('a', 'Cached shared memory')]));
    const omni = await Omnimind.create({ dataDir: tmpDir, adapters: false, sharedTransport: fake });

    const first = await omni.getContextInjection();
    expect(first.ok).toBe(true);
    const callsAfterFirst = fake.calls;

    const second = await omni.getContextInjection();
    expect(second.ok).toBe(true);
    expect(fake.calls).toBe(callsAfterFirst); // served from cache

    // Expire the cache artificially
    (omni as any).sharedCache = null;
    fake.enqueueText(JSON.stringify([RESULT('c', 'Fresh after expiry')]));
    const third = await omni.getContextInjection();
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.value).toContain('Fresh after expiry');
    await omni.close();
  });
});
```

- [ ] **Step 2: Verificare che il test fallisca**

Run: `npx vitest run tests/shared/SharedContext.test.ts`
Expected: FAIL — `sharedCache` inesistente, blocco mai prodotto (asserzioni `toContain` fallite).

- [ ] **Step 3: Implementare**

**(a)** Aggiungere campo cache alla classe (accanto a `sharedSuggestions`, Task 3):

```typescript
  private sharedCache: { key: string; text: string; at: number } | null = null;
```

**(b)** Sostituire `getContextInjection()` (righe 701-706) con:

```typescript
  async getContextInjection(): Promise<Result<string>> {
    const fingerprint = this.activityTracker.getCurrentFingerprint();
    const injection = await this.contextInjector.inject(fingerprint);
    if (!injection.ok) return err(injection.error);
    const sharedBlock = await this.buildSharedContextBlock(fingerprint);
    return ok(injection.value.text + sharedBlock);
  }
```

**(c)** Aggiungere il metodo privato subito dopo `getContextInjection`:

```typescript
  /**
   * Build the <omnimind_shared> context block from the shared server.
   * Best-effort: any failure (or missing config) yields an empty string —
   * local memory never depends on the shared server.
   */
  private async buildSharedContextBlock(fingerprint: ContextFingerprint): Promise<string> {
    if (!this.sharedAvailable()) return '';

    const key = `${fingerprint.projectHash}:${fingerprint.branchHash}:${fingerprint.fileExtension}`;
    if (this.sharedCache && this.sharedCache.key === key && Date.now() - this.sharedCache.at < 60_000) {
      return this.sharedCache.text;
    }

    const queryParts = [...fingerprint.recentWings, ...fingerprint.recentRooms]
      .filter((p) => p.length > 0 && p !== 'unknown');
    const query = queryParts.length > 0 ? queryParts.join(' ') : 'general';

    const result = await this.shared!.search(query, 3);
    if (!result.ok) {
      this.handleSharedError(result.error);
      return '';
    }

    const visible = result.value.filter((r) => r.item.supersededAt === null);
    const suggestions = this.getSharedSuggestions().slice(0, 3);
    if (visible.length === 0 && suggestions.length === 0) return '';

    const lines: string[] = [];
    for (const s of suggestions) {
      lines.push(`shared_suggestion [L${s.level}] ${s.content.substring(0, 200)} (id: ${s.memoryId.substring(0, 8)})`);
    }
    for (const r of visible) {
      lines.push(`[${r.item.visibility}] ${r.item.content.substring(0, 200)}`);
    }

    const text = `\n<omnimind_shared count="${lines.length}">\n${lines.join('\n')}\n</omnimind_shared>\n`;
    this.sharedCache = { key, text, at: Date.now() };
    return text;
  }
```

- [ ] **Step 4: Verificare che i test passino**

Run: `npx vitest run tests/shared/SharedContext.test.ts`
Expected: PASS (5 test).

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/shared/SharedContext.test.ts
git commit -m "feat(shared): omnimind_shared block in context injection with 60s cache"
```

---

### Task 5: Tool MCP `omnimind_shared_search` / `omnimind_shared_publish` / `omnimind_shared_status`

**Files:**
- Modify: `src/mcp/server.ts` (schemas; tool list; switch; tre handler)
- Test: `tests/mcp/sharedTools.test.ts`

**Interfaces:**
- Consumes (Task 3): `omni.sharedAvailable()`, `omni.shared`, `omni.publishMemoryToShared(id, opts)`.
- Produces: handler privati `handleSharedSearch`, `handleSharedPublish`, `handleSharedStatus` (testati via `(server as any)` come in `tests/mcp/isolation.test.ts`).

- [ ] **Step 1: Scrivere il test**

```typescript
/**
 * Tests for the three shared-server MCP tools. Follows the isolation.test.ts
 * pattern: construct the server without init() and inject the facade bits.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ok } from '../../src/core/types.js';
import { OmnimindMcpServer } from '../../src/mcp/server.js';
import type { SharedSearchResult } from '../../src/shared/types.js';

const NOT_CONFIGURED = 'Shared memory server not configured';

function makeServer(overrides: Record<string, unknown> = {}): OmnimindMcpServer {
  const server = new OmnimindMcpServer();
  const searchResults: SharedSearchResult[] = [
    {
      item: {
        id: 'x1',
        content: 'Org memory about CI',
        level: 2,
        visibility: 'org',
        metadata: {},
        trustWeight: 0.7,
        createdAt: 1,
        supersededAt: null,
      },
      score: 0.83,
      matchType: 'hybrid',
    },
  ];
  (server as any).omni = {
    sharedAvailable: () => true,
    shared: {
      search: async () => ok(searchResults),
      status: async () => ok({ items: 12, superseded: 3 }),
      publish: async () => ok('new-uuid'),
      close: async () => {},
    },
    publishMemoryToShared: async () => ok('new-uuid'),
    ...overrides,
  };
  return server;
}

describe('MCP shared tools', () => {
  let server: OmnimindMcpServer;

  beforeEach(() => {
    server = makeServer();
  });

  it('omnimind_shared_search returns formatted results', async () => {
    const handler = (server as any).handleSharedSearch.bind(server);
    const result = await handler({ query: 'CI pipeline' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Found 1 shared memories');
    expect(result.content[0].text).toContain('Org memory about CI');
  });

  it('omnimind_shared_search reports not-configured without error', async () => {
    server = makeServer({ sharedAvailable: () => false, shared: null });
    const handler = (server as any).handleSharedSearch.bind(server);
    const result = await handler({ query: 'CI' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain(NOT_CONFIGURED);
  });

  it('omnimind_shared_publish delegates to publishMemoryToShared', async () => {
    let received: unknown = null;
    server = makeServer({
      publishMemoryToShared: async (id: string, opts: unknown) => {
        received = { id, opts };
        return ok('new-uuid');
      },
    });
    const handler = (server as any).handleSharedPublish.bind(server);
    const result = await handler({ memory_id: 'mem-1', visibility: 'team', workspace_id: 'ws-9' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('new-uuid');
    expect(received).toEqual({ id: 'mem-1', opts: { visibility: 'team', workspaceId: 'ws-9' } });
  });

  it('omnimind_shared_publish requires workspace_id for team visibility', async () => {
    const handler = (server as any).handleSharedPublish.bind(server);
    const result = await handler({ memory_id: 'mem-1', visibility: 'team' });

    expect(result.isError).toBe(true);
  });

  it('omnimind_shared_status reports stats', async () => {
    const handler = (server as any).handleSharedStatus.bind(server);
    const result = await handler();

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('12 items');
  });

  it('omnimind_shared_status reports not-configured', async () => {
    server = makeServer({ sharedAvailable: () => false, shared: null });
    const handler = (server as any).handleSharedStatus.bind(server);
    const result = await handler();

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain(NOT_CONFIGURED);
  });
});
```

Nota: `handleSharedPublish` con `visibility: 'team'` senza `workspace_id` deve lanciare un Error (lo switch globale lo converte in `isError: true`) oppure ritornare `{isError: true}` direttamente — implementare ritornando direttamente `{ content: [...], isError: true }` per non dipendere dal catch globale nei test diretti dell'handler.

- [ ] **Step 2: Verificare che il test fallisca**

Run: `npx vitest run tests/mcp/sharedTools.test.ts`
Expected: FAIL — handler inesistenti.

- [ ] **Step 3: Implementare in `src/mcp/server.ts`**

**(a) Schemi** — dopo `CompressContextInput` (riga 113):

```typescript
const SharedSearchInput = z.object({
  query: z.string().min(1).max(1000).describe('Search query for the shared team/org memory server'),
  limit: z.number().min(1).max(50).optional().describe('Maximum results'),
});

const SharedPublishInput = z.object({
  memory_id: z.string().min(1).describe('ID of a local L2 (concept) or L3 (wisdom) memory to publish'),
  visibility: z.enum(['team', 'org']).describe('Who can see the published item on the shared server'),
  workspace_id: z.string().optional().describe('Required when visibility=team'),
  trust_weight: z.number().min(0).max(1).optional().describe('Confidence in this content (0-1)'),
});
```

**(b) Tool list** — aggiungere tre entry in fondo all'array in `ListToolsRequestSchema` (dopo `omnimind_compress_context`, riga 254):

```typescript
        {
          name: 'omnimind_shared_search',
          description: 'Search the shared team/org memory server — L2/L3 knowledge promoted by you and your teammates. Requires shared server configuration (omnimind shared config).',
          inputSchema: convertZodToJsonSchema(SharedSearchInput),
        },
        {
          name: 'omnimind_shared_publish',
          description: 'Publish a local L2/L3 memory to the shared team/org memory server. This shares content beyond this machine — get explicit user approval first.',
          inputSchema: convertZodToJsonSchema(SharedPublishInput),
        },
        {
          name: 'omnimind_shared_status',
          description: 'Check connectivity and statistics of the shared team/org memory server.',
          inputSchema: { type: 'object', properties: {} },
        },
```

**(c) Switch cases** — aggiungere prima del `default:` (riga 278):

```typescript
          case 'omnimind_shared_search':
            return await this.handleSharedSearch(request.params.arguments);
          case 'omnimind_shared_publish':
            return await this.handleSharedPublish(request.params.arguments);
          case 'omnimind_shared_status':
            return await this.handleSharedStatus();
```

**(d) Handler** — aggiungere in fondo alla classe, dopo `handleCompressContext` (prima della chiusura classe riga 871):

```typescript
  private sharedNotConfigured() {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'Shared memory server not configured. Set it up with: omnimind shared config --url <url> --token <token>',
        },
      ],
    };
  }

  private async handleSharedSearch(args: unknown) {
    const input = SharedSearchInput.parse(args);
    if (!this.omni?.sharedAvailable() || !this.omni.shared) {
      return this.sharedNotConfigured();
    }

    const result = await this.omni.shared.search(input.query, input.limit);
    if (!result.ok) throw result.error;

    if (result.value.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No shared memories matched.' }] };
    }

    const lines = result.value.map((r, i) =>
      `${i + 1}. [${r.item.visibility}] (score ${r.score.toFixed(3)}, ${r.matchType})\n   ${r.item.content.substring(0, 300)}${r.item.content.length > 300 ? '...' : ''}`,
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: `Found ${result.value.length} shared memories:\n\n${lines.join('\n\n')}`,
        },
      ],
    };
  }

  private async handleSharedPublish(args: unknown) {
    const input = SharedPublishInput.parse(args);
    if (!this.omni?.sharedAvailable()) {
      return this.sharedNotConfigured();
    }
    if (input.visibility === 'team' && !input.workspace_id) {
      return {
        content: [{ type: 'text' as const, text: 'Error: workspace_id is required when visibility=team' }],
        isError: true,
      };
    }

    const result = await this.omni.publishMemoryToShared(input.memory_id, {
      visibility: input.visibility,
      ...(input.workspace_id !== undefined ? { workspaceId: input.workspace_id } : {}),
      ...(input.trust_weight !== undefined ? { trustWeight: input.trust_weight } : {}),
    });
    if (!result.ok) throw result.error;

    return {
      content: [
        {
          type: 'text' as const,
          text: `Published to shared memory with id ${result.value}.`,
        },
      ],
    };
  }

  private async handleSharedStatus() {
    if (!this.omni?.sharedAvailable() || !this.omni.shared) {
      return this.sharedNotConfigured();
    }

    const result = await this.omni.shared.status();
    if (!result.ok) throw result.error;

    return {
      content: [
        {
          type: 'text' as const,
          text: `Shared server OK — ${result.value.items} items visible (${result.value.superseded} superseded).`,
        },
      ],
    };
  }
```

- [ ] **Step 4: Verificare che i test passino**

Run: `npx vitest run tests/mcp/sharedTools.test.ts`
Expected: PASS (6 test).

- [ ] **Step 5: Typecheck + lint + suite completa**

Run: `npm run typecheck && npm run lint && npm test`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/server.ts tests/mcp/sharedTools.test.ts
git commit -m "feat(shared): MCP tools omnimind_shared_search/publish/status"
```

---

### Task 6: CLI `omnimind shared`

**Files:**
- Modify: `src/cli.ts` (registrazione comando riga 30-43; help riga 95-151; nuovo `sharedCommand`)
- Test: nessuno (src/cli.ts è escluso dal coverage e non ha test esistenti; verifica manuale)

**Interfaces:**
- Consumes (Task 3): `omni.sharedAvailable()`, `omni.shared`, `omni.getSharedSuggestions()`, `omni.publishMemoryToShared(id, opts)`, `omni.setSetting()`.

- [ ] **Step 1: Registrare il comando**

In `commands` (riga 30-43) aggiungere `shared: sharedCommand,` dopo `bus: busCommand,`.

- [ ] **Step 2: Aggiungere la sezione help**

In `printHelp()` dopo il blocco `bus` (riga 141-143):

```
  shared config --url <url> --token <token> [--enable|--disable]
                          Configure the shared team/org memory server
  shared status           Test connection and show shared stats
  shared search <query>   Search the shared memory server
  shared publish --id <id> --visibility org|team [--workspace-id <uuid>]
                          Publish a local L2/L3 memory to the shared server
  shared suggestions      List local L2/L3 memories pending publish
```

- [ ] **Step 3: Implementare `sharedCommand`**

Aggiungere dopo `busCommand` (prima di `setupCommand`, riga 451):

```typescript
async function sharedCommand(args: string[]): Promise<void> {
  const subcmd = args[0];
  if (!subcmd || subcmd === '--help') {
    console.log(`
Shared memory server commands:
  shared config --url <url> --token <token> [--enable|--disable]
  shared status              Test connection and show shared stats
  shared search <query> [--limit N]
  shared publish --id <memoryId> --visibility org|team [--workspace-id <uuid>]
  shared suggestions         List local L2/L3 memories pending publish
`);
    return;
  }

  const omni = await Omnimind.create({
    adapters: false,
    dataDir: process.env.OMNIMIND_DATA_DIR ?? undefined,
  });

  switch (subcmd) {
    case 'config': {
      const url = parseFlag(args, '--url');
      const token = parseFlag(args, '--token');
      if (url === null && token === null && !args.includes('--enable') && !args.includes('--disable')) {
        console.error('Usage: omnimind shared config --url <url> --token <token> [--enable|--disable]');
        await omni.close();
        process.exit(1);
      }
      if (url !== null) omni.setSetting('sharedServerUrl', url);
      if (token !== null) omni.setSetting('sharedToken', token);
      if (args.includes('--enable')) omni.setSetting('sharedEnabled', 'true');
      if (args.includes('--disable')) omni.setSetting('sharedEnabled', 'false');
      console.log('Shared server configuration saved. Restart the MCP server / app to apply.');
      break;
    }

    case 'status': {
      if (!omni.sharedAvailable()) {
        console.log('Shared memory server: not configured (or token unauthorized).');
        const last = omni.getSetting('lastSharedError');
        if (last.ok && last.value) console.log(`Last error: ${last.value}`);
      } else {
        const result = await omni.shared!.status();
        if (result.ok) {
          console.log(`Shared server OK — ${result.value.items} items visible (${result.value.superseded} superseded).`);
        } else {
          console.error(`Error: ${result.error.message}`);
        }
      }
      break;
    }

    case 'search': {
      const query = args[1];
      if (!query) {
        console.error('Usage: omnimind shared search <query> [--limit N]');
        await omni.close();
        process.exit(1);
      }
      if (!omni.sharedAvailable()) {
        console.log('Shared memory server: not configured. Run: omnimind shared config --help');
        break;
      }
      const limit = parseInt(parseFlag(args, '--limit') ?? '10', 10);
      const result = await omni.shared!.search(query, limit);
      if (!result.ok) {
        console.error(`Error: ${result.error.message}`);
        break;
      }
      if (result.value.length === 0) {
        console.log('No shared memories found.');
      } else {
        console.log(`Found ${result.value.length} shared memories:\n`);
        for (const [i, r] of result.value.entries()) {
          console.log(`${i + 1}. [${r.item.visibility}] ${r.matchType} (score: ${r.score.toFixed(3)})`);
          console.log(`   ${r.item.content.substring(0, 200)}${r.item.content.length > 200 ? '...' : ''}\n`);
        }
      }
      break;
    }

    case 'publish': {
      const id = parseFlag(args, '--id');
      const visibility = parseFlag(args, '--visibility');
      const workspaceId = parseFlag(args, '--workspace-id');
      if (id === null || (visibility !== 'org' && visibility !== 'team')) {
        console.error('Usage: omnimind shared publish --id <memoryId> --visibility org|team [--workspace-id <uuid>]');
        await omni.close();
        process.exit(1);
      }
      const result = await omni.publishMemoryToShared(id, {
        visibility,
        ...(workspaceId !== null ? { workspaceId } : {}),
      });
      if (result.ok) {
        console.log(`✓ Published with shared id ${result.value}`);
      } else {
        console.error(`Error: ${result.error.message}`);
      }
      break;
    }

    case 'suggestions': {
      const suggestions = omni.getSharedSuggestions();
      if (suggestions.length === 0) {
        console.log('No pending suggestions.');
      } else {
        console.log(`Pending publish suggestions (${suggestions.length}):\n`);
        for (const s of suggestions) {
          console.log(`  [L${s.level}] ${s.content.substring(0, 120)}${s.content.length > 120 ? '...' : ''} (id: ${s.memoryId.substring(0, 8)})`);
        }
      }
      break;
    }

    default:
      console.error(`Unknown shared command: ${subcmd}`);
      await omni.close();
      process.exit(1);
  }

  await omni.close();
}
```

- [ ] **Step 4: Build + smoke test manuale (senza rete — solo config/status)**

```bash
npm run build
TMPDIR_DATA=$(mktemp -d)
OMNIMIND_DATA_DIR=$TMPDIR_DATA node dist/cli.js shared config --url https://example.invalid/mcp --token omt_test --enable
OMNIMIND_DATA_DIR=$TMPDIR_DATA node dist/cli.js shared status
OMNIMIND_DATA_DIR=$TMPDIR_DATA node dist/cli.js shared suggestions
rm -rf $TMPDIR_DATA
```

Expected: config stampa "configuration saved"; status stampa "not configured" solo se settings non letti — nota: il client in `create()` legge i settings salvati, quindi il secondo comando deve trovare url/token e tentare la connessione (fallirà con errore di rete, senza crash). `suggestions` stampa "No pending suggestions."

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat(shared): omnimind shared CLI command"
```

---

### Task 7: Endpoint `GET /api/shared/test`

**Files:**
- Modify: `src/server.ts` (import; nuovo endpoint dopo `/api/settings`)
- Test: verifica manuale (src/server.ts è escluso dal coverage; i test server esistenti spawnano dist — troppo pesanti per un endpoint best-effort che richiede rete)

**Interfaces:**
- Consumes (Task 2): `McpSharedClient` con `status()`.

- [ ] **Step 1: Implementare l'endpoint**

**(a)** Aggiungere import in cima (dopo l'import di Omnimind, riga 31):

```typescript
import { McpSharedClient } from './shared/McpSharedClient.js';
```

**(b)** Aggiungere l'endpoint subito dopo il blocco `/api/settings` (dopo la riga con `sendJson(res, 200, { ok: true });` e la `}` di chiusura del blocco settings, ~riga 468), prima di `// MCP client setup`:

```typescript
  // Shared server connectivity test — builds an ad-hoc client from the
  // CURRENT settings so the GUI can test unsaved... saved-but-not-applied
  // configurations without a restart.
  if (path === '/api/shared/test' && method === 'GET') {
    const enabled = omni!.getSetting('sharedEnabled');
    if (enabled.ok && enabled.value !== 'true') {
      sendJson(res, 200, { connected: false, reason: 'disabled' });
      return;
    }
    const url = omni!.getSetting('sharedServerUrl');
    const token = omni!.getSetting('sharedToken');
    if ((!url.ok || !url.value) || (!token.ok || !token.value)) {
      sendJson(res, 200, { connected: false, reason: 'not configured' });
      return;
    }
    const client = new McpSharedClient({ serverUrl: url.value, token: token.value, timeoutMs: 5000 });
    try {
      const status = await client.status();
      if (status.ok) {
        sendJson(res, 200, {
          connected: true,
          items: status.value.items,
          superseded: status.value.superseded,
        });
      } else {
        sendJson(res, 200, {
          connected: false,
          reason: status.error.kind,
          message: status.error.message,
        });
      }
    } finally {
      await client.close().catch(() => {});
    }
    return;
  }
```

- [ ] **Step 2: Build + verifica manuale**

```bash
npm run build
TMPDIR_DATA=$(mktemp -d)
OMNIMIND_DATA_DIR=$TMPDIR_DATA OMNIMIND_PORT=18944 OMNIMIND_SKIP_ADAPTERS=1 node dist/server.js &
SERVER_PID=$!
sleep 3
curl -s http://localhost:18944/api/shared/test
# Expected: {"connected":false,"reason":"not configured"}
kill $SERVER_PID
rm -rf $TMPDIR_DATA
```

- [ ] **Step 3: Commit**

```bash
git add src/server.ts
git commit -m "feat(shared): GET /api/shared/test connectivity endpoint"
```

---

### Task 8: GUI — sezione impostazioni "Shared Memory Server"

**Files:**
- Modify: `gui/src/lib/api.ts` (metodo `sharedTest`)
- Modify: `gui/src/lib/components/SettingsPanel.svelte` (campi form, sezione UI, handler test)
- Test: `cd gui && npm run build`

**Interfaces:**
- Consumes (Task 7): `GET /api/shared/test` → `{ connected: boolean; reason?: string; message?: string; items?: number; superseded?: number }`.

- [ ] **Step 1: Aggiungere `sharedTest` all'API client**

In `gui/src/lib/api.ts`, nell'oggetto `api` dopo `setSetting` (riga 248-253):

```typescript
  sharedTest: () =>
    fetchJson<{ connected: boolean; reason?: string; message?: string; items?: number; superseded?: number }>(
      '/api/shared/test',
    ),
```

- [ ] **Step 2: Aggiungere campi form e handler in `SettingsPanel.svelte`**

**(a)** Nel `$state` `form` (riga 21-28) aggiungere:

```typescript
    sharedEnabled: 'false',
    sharedServerUrl: '',
    sharedToken: '',
```

**(b)** In `onMount` dopo `form.autoEvictDays = ...` (riga 38) aggiungere:

```typescript
      form.sharedEnabled = settings.sharedEnabled || 'false';
      form.sharedServerUrl = settings.sharedServerUrl || '';
      form.sharedToken = settings.sharedToken || '';
```

**(c)** In `reset()` dopo `form.autoEvictDays = ...` (riga 110) aggiungere le stesse tre assegnazioni da `settings`.

**(d)** Aggiungere state per il test (dopo `let connectMsg`, riga 18):

```typescript
  let isTestingShared = $state(false);
  let sharedTestMsg = $state<string | null>(null);
  let sharedTestOk = $state(false);
```

**(e)** Aggiungere l'handler (dopo `handleEvict`, riga 178):

```typescript
  async function handleSharedTest() {
    isTestingShared = true;
    sharedTestMsg = null;
    try {
      // Save first: the endpoint reads persisted settings, not the form.
      await api.setSetting('sharedEnabled', form.sharedEnabled);
      await api.setSetting('sharedServerUrl', form.sharedServerUrl);
      await api.setSetting('sharedToken', form.sharedToken);
      const result = await api.sharedTest();
      sharedTestOk = result.connected;
      sharedTestMsg = result.connected
        ? `Connected — ${result.items} shared items visible (${result.superseded} superseded).`
        : `Not connected: ${result.reason ?? 'unknown'}${result.message ? ` — ${result.message}` : ''}`;
    } catch (e) {
      sharedTestOk = false;
      sharedTestMsg = `Test failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      isTestingShared = false;
    }
  }
```

**(f)** Aggiungere la sezione UI dopo la sezione `<!-- Advanced -->` (dopo la sua `</section>`, ~riga 279), prima di `<!-- Connect AI Tools -->`:

```svelte
      <!-- Shared Memory Server -->
      <section class="bg-[var(--surface)] rounded-xl p-6 border border-[var(--border)]">
        <h3 class="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wider mb-4">Shared Memory Server</h3>
        <p class="text-xs text-[var(--text-muted)] mb-4">
          Connect to your team's shared memory server to search and publish promoted (L2/L3) knowledge.
          Your personal memory stays local.
        </p>
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-sm text-[var(--text)]">Enable Shared Memory</div>
              <div class="text-xs text-[var(--text-muted)]">Requires a server URL and token from your admin.</div>
            </div>
            <button
              onclick={() => form.sharedEnabled = form.sharedEnabled === 'true' ? 'false' : 'true'}
              class="relative w-11 h-6 rounded-full transition-colors {form.sharedEnabled === 'true' ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}"
            >
              <span class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform {form.sharedEnabled === 'true' ? 'translate-x-5' : ''}"></span>
            </button>
          </div>
          <div>
            <label class="block text-sm text-[var(--text)] mb-1">Server URL</label>
            <input
              type="text"
              bind:value={form.sharedServerUrl}
              placeholder="https://omnimind-server.example.com/mcp"
              class="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div>
            <label class="block text-sm text-[var(--text)] mb-1">Token</label>
            <input
              type="password"
              bind:value={form.sharedToken}
              placeholder="omt_..."
              class="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div class="flex items-center gap-3">
            <button
              onclick={handleSharedTest}
              disabled={isTestingShared}
              class="px-4 py-2 bg-[var(--surface)] border border-[var(--border)] text-sm rounded-lg hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50"
            >
              {isTestingShared ? 'Testing...' : 'Test Connection'}
            </button>
            {#if sharedTestMsg}
              <span class="text-sm {sharedTestOk ? 'text-green-400' : 'text-yellow-400'}">{sharedTestMsg}</span>
            {/if}
          </div>
        </div>
      </section>
```

- [ ] **Step 3: Build GUI**

Run: `cd gui && npm run build`
Expected: build Vite senza errori.

- [ ] **Step 4: Commit**

```bash
git add gui/src/lib/api.ts gui/src/lib/components/SettingsPanel.svelte
git commit -m "feat(shared): GUI settings section for shared memory server"
```

---

### Task 9: Export pubblici, docs e verifica finale

**Files:**
- Modify: `src/index.ts` (export in fondo)
- Modify: `AGENTS.md` (lista tool MCP, comandi CLI, chiavi settings)

- [ ] **Step 1: Aggiungere export in `src/index.ts`**

Prima del blocco `// ─── Convenience Exports ───` aggiungere:

```typescript
export { McpSharedClient } from './shared/McpSharedClient.js';
export {
  SharedError,
  type SharedClient,
  type SharedClientConfig,
  type SharedErrorKind,
  type SharedItem,
  type SharedPublishInput,
  type SharedSearchResult,
  type SharedStatus,
  type SharedSuggestion,
  type SharedToolTransport,
} from './shared/types.js';
```

- [ ] **Step 2: Aggiornare `AGENTS.md`**

- Nella sezione "MCP Server (`src/mcp/server.ts`)" aggiungere i tre tool alla lista bullet:
  - `` - `omnimind_shared_search` / `omnimind_shared_publish` / `omnimind_shared_status` — shared team/org memory server (remote MCP; configured via `omnimind shared config`) ``
- Nella sezione "CLI (`src/cli.ts`)" aggiornare la riga dei comandi: aggiungere `` `shared` ``.
- Aggiungere riga alla tabella Environment Variables o una nota: chiavi settings `sharedEnabled`/`sharedServerUrl`/`sharedToken`.

- [ ] **Step 3: Verifica completa**

```bash
npm run typecheck && npm test && npm run lint && npm run build && cd gui && npm run build
```

Expected: tutto verde; coverage sopra soglia (il nuovo codice src/shared è coperto dai test Task 2-4).

- [ ] **Step 4: Commit finale**

```bash
git add src/index.ts AGENTS.md
git commit -m "feat(shared): public exports and docs"
```

---

## Self-Review (eseguito)

- **Spec coverage**: connessione/settings ✓ (Task 3), shared_search ✓ (Task 2/4/5/6), shared_publish esplicito+suggerimento ✓ (Task 3 hook + Task 4 blocco + Task 5/6), shared_status ✓ (Task 2/5/6/7), fallback offline ✓ (Task 4 omissione silenziosa + Task 2 retry rules), retry 429/5xx + no-retry 401 ✓ (Task 2), 401→disattivazione ✓ (Task 3 handleSharedError), superseded filter ✓ (Task 4), GUI ✓ (Task 7/8), CLI ✓ (Task 6), export ✓ (Task 9), docs ✓ (Task 9).
- **Nomenclatura consistente**: `sharedAvailable`, `getSharedSuggestions`, `publishMemoryToShared`, `noteSharedSuggestion`, `handleSharedError`, `buildSharedContextBlock`, `sharedCache` usati identici in tutti i task.
- **Nessun placeholder**: ogni step contiene codice completo o comandi esatti.
