# Shared Pending-Publish GUI + Lucide Icons — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portare il flusso "publish memoria L2/L3 sul server condiviso" nella GUI (tab "Shared") e sostituire le emoji con icone Lucide monocolore.

**Architecture:** Due endpoint REST aggiunti a `src/server.ts` (thin wrapper su metodi facade esistenti `getSharedSuggestions()` / `publishMemoryToShared()`), un pannello Svelte 5 che li consuma via `api.ts`, e un pass di sostituzione icone. Il facade e lo storage suggestions sono già implementati e fixati (v0.8.4).

**Tech Stack:** TypeScript strict (NodeNext, import `.js`), Svelte 5 runes, TailwindCSS, `lucide-svelte`, Vitest, better-sqlite3, MCP SDK (`@modelcontextprotocol/sdk`).

**Spec:** `docs/superpowers/specs/2026-09-25-shared-publish-gui-design.md`
**Branch:** `feat/shared-gui` (già creato da `origin/dev`, contiene il commit dello spec).

## Global Constraints

- TS strict + `exactOptionalPropertyTypes: true` — optional props si passano solo con spread condizionale (`...(x !== undefined ? { x } : {})`).
- Import locali da `src/` verso altri file TS: estensione `.js`. Nella GUI (`gui/src`): import senza estensione (risoluzione Vite), pattern `import { api } from '../api'`.
- Mai throw per errori attesi: pattern `Result<T, E>` nel backend; HTTP error come status code JSON.
- Test timeout 30s; suite completa ha flake noti su `tests/bus/adapters/*` sotto carico (verdi in isolamento — non sono regressioni).
- I test server spawnano `dist/server.js` compilato: **sempre `npm run build` prima di lanciare `tests/server/`**.
- GUI: nessun test esistente — verifica = `cd gui && npm run build`.
- Componenti Svelte 5 con runes (`$state`), eventi `onclick=` (non `on:`), classi Tailwind con variabili tema `var(--*)`.
- 3 commit separati: endpoints+test / pannello GUI / icone. PR verso `dev`.

## File Structure

- Modify `src/server.ts` — 2 endpoint accanto a `/api/shared/test` (dopo la riga ~547).
- Create `tests/server/SharedPublishEndpoint.test.ts` — test spawn-server con fake MCP shared server (JSON-RPC-aware).
- Modify `gui/src/lib/api.ts` — `SharedSuggestionDto` + `sharedSuggestions()` + `sharedPublish()`.
- Modify `gui/src/lib/stores.svelte.ts` — aggiungere `'shared'` ad `activeTab`.
- Modify `gui/src/App.svelte` — voce nav "Shared" + rendering pannello + refactor nav a componenti icona.
- Create `gui/src/lib/components/PendingPublishPanel.svelte` — il pannello.
- Modify `gui/src/lib/components/MemoryCard.svelte` — 📌/✎ → `Pin`/`Pencil`.
- Modify `gui/src/lib/components/SpatialMap.svelte` — 📌 → `Pin`.
- `gui/package.json` — dipendenza `lucide-svelte`.

---

### Task 1: Endpoint `GET /api/shared/suggestions`

**Files:**
- Modify: `src/server.ts` (inserire subito dopo il blocco `/api/shared/test`, prima di `// MCP client setup`)
- Test: `tests/server/SharedPublishEndpoint.test.ts` (creato in questo task con il solo test GET)

**Interfaces:**
- Consumes: `Omnimind.getSharedSuggestions(): SharedSuggestion[]` (già esistente, `src/index.ts:906`); tipo `SharedSuggestion = { memoryId: string; content: string; level: number; suggestedAt: number }` (già esistente, `src/core/types.ts`).
- Produces: `GET /api/shared/suggestions` → `200 SharedSuggestion[]` (array JSON piano, nessun wrapper). Il Task 3 consuma questo shape.

- [ ] **Step 1: Scrivi il test (file completo, con seeding facade e fake MCP server)**

```typescript
/**
 * Shared suggestions + publish endpoints.
 *
 * Seeds a real data dir through the Omnimind facade (memory L2 + suggestion
 * row + shared settings pointing at a fake MCP server), then spawns the
 * compiled server against the same data dir.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import { createServer, type Server as HttpServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Omnimind } from '../../src/index.js';
import type { SharedToolTransport } from '../../src/shared/types.js';

/** Canned-response transport: no network during seeding. */
class FakeTransport implements SharedToolTransport {
  async callTool(): Promise<unknown> {
    throw new Error('FakeTransport: not used in seeding');
  }
  async reset(): Promise<void> {}
  async close(): Promise<void> {}
}

/** Minimal JSON-RPC responder sufficient for the MCP SDK handshake. */
function startFakeShared(): Promise<{ server: HttpServer; port: number }> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let rpc: { id?: number | string; method?: string } = {};
      try {
        rpc = JSON.parse(body);
      } catch {
        /* notification with empty body — ignore */
      }
      const respond = (result: unknown): void => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id ?? null, result }));
      };
      if (rpc.method === 'initialize') {
        respond({
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'fake-shared', version: '0.0.1' },
        });
      } else if (rpc.method === 'tools/call') {
        respond({ content: [{ type: 'text', text: '{"id":"shared-1"}' }], isError: false });
      } else {
        respond({}); // notifications/initialized, pings
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as AddressInfo).port });
    });
  });
}

describe('Shared suggestions + publish endpoints', () => {
  let server: ChildProcess;
  let port: number;
  let home: string;
  let dataDir: string;
  let fakeShared: HttpServer;
  let fakeSharedPort: number;
  let memoryId: string;

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'omnimind-sharedpub-home-'));
    dataDir = mkdtempSync(join(tmpdir(), 'omnimind-sharedpub-data-'));
    ({ server: fakeShared, port: fakeSharedPort } = await startFakeShared());

    // Seed via the facade: real memory L2 + real suggestion row + settings.
    const omni = await Omnimind.create({ dataDir, adapters: false, sharedTransport: new FakeTransport() });
    const stored = await omni.store('Promoted concept about testing', { wing: 'eng' });
    if (!stored.ok) throw new Error('seed store failed');
    const updated = await omni.memoryStore.update(stored.value.id, { layer: 2 });
    if (!updated.ok) throw new Error('seed update failed');
    (omni as unknown as { noteSharedSuggestion(m: unknown): void }).noteSharedSuggestion(updated.value);
    memoryId = stored.value.id;
    omni.setSetting('sharedEnabled', 'true');
    omni.setSetting('sharedServerUrl', `http://127.0.0.1:${fakeSharedPort}/mcp`);
    omni.setSetting('sharedToken', 'omt_test_token');
    await omni.close();

    server = spawn('node', [join(process.cwd(), 'dist/server.js')], {
      env: {
        ...process.env,
        OMNIMIND_PORT: '0',
        OMNIMIND_SKIP_ADAPTERS: '1',
        OMNIMIND_DATA_DIR: dataDir,
        HOME: home,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server startup timeout')), 15000);
      server.stdout?.on('data', (data: Buffer) => {
        const match = data.toString().match(/Listening on http:\/\/(?:localhost|127\.0\.0\.1):(\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(parseInt(match[1], 10));
        }
      });
      server.on('error', reject);
    });

    const deadline = Date.now() + 30000;
    for (;;) {
      try {
        const res = await fetch(`http://localhost:${port}/api/health`);
        const health = await res.json();
        if (health.status === 'ok') break;
        if (health.status === 'failed') throw new Error('Server initialization failed');
      } catch (e) {
        if (e instanceof Error && e.message === 'Server initialization failed') throw e;
      }
      if (Date.now() > deadline) throw new Error('Server ready timeout');
      await new Promise((r) => setTimeout(r, 500));
    }
  }, 120000);

  afterAll(async () => {
    server?.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    fakeShared.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  const get = async (p: string) => {
    const res = await fetch(`http://localhost:${port}${p}`);
    return { status: res.status, data: await res.json() };
  };
  const post = async (p: string, body?: unknown) => {
    const res = await fetch(`http://localhost:${port}${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, data: await res.json() };
  };

  it('GET /api/shared/suggestions lists the seeded pending suggestion', async () => {
    const { status, data } = await get('/api/shared/suggestions');
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(1);
    expect(data[0].memoryId).toBe(memoryId);
    expect(data[0].level).toBe(2);
    expect(data[0].content).toContain('Promoted concept');
  });
});
```

- [ ] **Step 2: Build + run test, verify it fails**

```bash
npm run build && npx vitest run tests/server/SharedPublishEndpoint.test.ts
```

Expected: FAIL — `GET /api/shared/suggestions` returns 404 (endpoint non esiste).

- [ ] **Step 3: Implementa l'endpoint in `src/server.ts`**

Inserire subito dopo la chiusura del blocco `if (path === '/api/shared/test' && ...)` (il cui `return; }` finale è ~riga 547), prima del commento `// MCP client setup`:

```typescript
  // Shared publish suggestions — local L2/L3 memories pending a publish
  // decision (noted on promotion, 24h TTL, cap 20).
  if (path === '/api/shared/suggestions' && method === 'GET') {
    sendJson(res, 200, omni!.getSharedSuggestions());
    return;
  }
```

Nota: il guard `omni === null` → 503 è già globale a riga 184 (prima di tutti gli endpoint), non va replicato.

- [ ] **Step 4: Run test, verify pass**

```bash
npm run build && npx vitest run tests/server/SharedPublishEndpoint.test.ts
```

Expected: 1 passed. (Il seeding in beforeAll carica il modello ONNX — il primo run può impiegare ~30-60s.)

- [ ] **Step 5: Commit (non ancora push — il commit 1 si completa nel Task 2)**

Non committare ancora: il commit `feat(server): ...` copre entrambi gli endpoint. Prosegui al Task 2.

---

### Task 2: Endpoint `POST /api/shared/publish`

**Files:**
- Modify: `src/server.ts` (subito dopo l'endpoint del Task 1)
- Test: `tests/server/SharedPublishEndpoint.test.ts` (aggiungere i test)

**Interfaces:**
- Consumes: `Omnimind.sharedAvailable(): boolean` (`src/index.ts:901`); `Omnimind.publishMemoryToShared(id: string, opts: { visibility: 'team' | 'org'; workspaceId?: string | undefined }): Promise<Result<string, Error>>` (`src/index.ts:915`) — il value è lo shared id (stringa).
- Produces: `POST /api/shared/publish` body `{ id, visibility: 'org' | 'team', workspaceId? }` → `200 { ok: true, sharedId }` | `400 { error }` | `404 { error }` | `502 { error }` | `503 { error }`. Il Task 3 consuma questo shape.

- [ ] **Step 1: Aggiungi i test (4 test nel describe esistente)**

```typescript
  it('POST /api/shared/publish publishes and removes the suggestion', async () => {
    const { status, data } = await post('/api/shared/publish', { id: memoryId, visibility: 'org' });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.sharedId).toBe('shared-1');

    // The pending list is now empty and the DB row is gone (not just filtered)
    const after = await get('/api/shared/suggestions');
    expect(after.data).toHaveLength(0);
    const db = new Database(join(dataDir, 'memory.db'), { readonly: true, fileMustExist: true });
    const rows = db.prepare('SELECT COUNT(*) AS n FROM shared_suggestions').get() as { n: number };
    db.close();
    expect(rows.n).toBe(0);
  });

  it('POST /api/shared/publish rejects an invalid visibility with 400', async () => {
    const { status, data } = await post('/api/shared/publish', { id: memoryId, visibility: 'public' });
    expect(status).toBe(400);
    expect(data.error).toBeDefined();
  });

  it('POST /api/shared/publish returns 404 for a missing memory id', async () => {
    const { status, data } = await post('/api/shared/publish', {
      id: '00000000-0000-0000-0000-000000000000',
      visibility: 'org',
    });
    expect(status).toBe(404);
    expect(data.error).toContain('Memory not found');
  });
```

Nota: il test 404 deve girare **prima** del test di successo oppure usare un id diverso da `memoryId` — l'ordine nel file conta: metti i test 400/404 **prima** del test di successo (vitest esegue in ordine di definizione nel file). L'ordine corretto: invalid visibility → missing id → success.

- [ ] **Step 2: Run tests, verify they fail**

```bash
npm run build && npx vitest run tests/server/SharedPublishEndpoint.test.ts
```

Expected: i 3 nuovi test FAIL (404 dal server: endpoint assente).

- [ ] **Step 3: Implementa l'endpoint in `src/server.ts`** (subito dopo l'endpoint del Task 1)

```typescript
  // Publish a local L2/L3 memory to the shared server (explicit user action).
  if (path === '/api/shared/publish' && method === 'POST') {
    if (!omni!.sharedAvailable()) {
      sendJson(res, 503, { error: 'Shared memory server not configured' });
      return;
    }
    const body = await readBody(req);
    const id = typeof body.id === 'string' ? body.id : undefined;
    const visibility =
      body.visibility === 'team' || body.visibility === 'org' ? body.visibility : undefined;
    const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : undefined;
    if (id === undefined || visibility === undefined) {
      sendJson(res, 400, { error: 'id and visibility (org|team) are required' });
      return;
    }
    const result = await omni!.publishMemoryToShared(id, {
      visibility,
      ...(workspaceId !== undefined ? { workspaceId } : {}),
    });
    if (!result.ok) {
      const msg = result.error.message;
      const notFound = msg.startsWith('Memory not found') || msg.startsWith('Only L2/L3');
      sendJson(res, notFound ? 404 : 502, { error: msg });
      return;
    }
    sendJson(res, 200, { ok: true, sharedId: result.value });
    return;
  }
```

- [ ] **Step 4: Run tests, verify all pass**

```bash
npm run build && npx vitest run tests/server/SharedPublishEndpoint.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Full verify + commit 1**

```bash
npm run typecheck && npm test && npm run lint && npm run build
```

Expected: tutto verde (flake adapter noti sotto carico ammessi, verdi in isolamento).

```bash
git add src/server.ts tests/server/SharedPublishEndpoint.test.ts
git commit -m "feat(server): GET /api/shared/suggestions + POST /api/shared/publish"
```

---

### Task 3: Client API in `gui/src/lib/api.ts`

**Files:**
- Modify: `gui/src/lib/api.ts` (DTO type prima di `export const api`; metodi dentro l'oggetto `api`, vicino a `sharedTest` ~riga 258)

**Interfaces:**
- Consumes: `GET /api/shared/suggestions` → `SharedSuggestion[]`; `POST /api/shared/publish` → `{ ok: boolean; sharedId: string }` (Task 1-2).
- Produces: `type SharedSuggestionDto = { memoryId: string; content: string; level: number; suggestedAt: number }`; `api.sharedSuggestions(): Promise<SharedSuggestionDto[]>`; `api.sharedPublish(id: string, visibility: 'org' | 'team', workspaceId?: string): Promise<{ ok: boolean; sharedId: string }>`. Il Task 4 consuma questi.

- [ ] **Step 1: Aggiungi il DTO (sopra `export const api`, dopo le altre interface ~riga 155)**

```typescript
export interface SharedSuggestionDto {
  memoryId: string;
  content: string;
  level: number;
  suggestedAt: number;
}
```

- [ ] **Step 2: Aggiungi i metodi dentro `api` (dopo `sharedTest`, prima della chiusura `};` ~riga 349)**

```typescript
  sharedSuggestions: () => fetchJson<SharedSuggestionDto[]>('/api/shared/suggestions'),

  sharedPublish: (id: string, visibility: 'org' | 'team', workspaceId?: string) =>
    fetchJson<{ ok: boolean; sharedId: string }>(
      '/api/shared/publish',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          workspaceId !== undefined ? { id, visibility, workspaceId } : { id, visibility },
        ),
      },
    ),
```

- [ ] **Step 3: Build GUI (è la verifica standard — non esiste typecheck dedicato)**

```bash
cd gui && npm run build
```

Expected: build verde.

- [ ] **Step 4: Non committare** — il commit 2 si completa nel Task 4.

---

### Task 4: Pannello `PendingPublishPanel` + wiring

**Files:**
- Create: `gui/src/lib/components/PendingPublishPanel.svelte`
- Modify: `gui/src/lib/stores.svelte.ts:4` (type `activeTab`)
- Modify: `gui/src/App.svelte` (import, nav ~120-137, rendering ~177-179)
- Modify: `gui/package.json` (dipendenza)
- Test: nessuno (convenzione repo — GUI non testata; verifica = build)

**Interfaces:**
- Consumes: `api.sharedSuggestions()`, `api.sharedPublish()`, `SharedSuggestionDto` (Task 3); `appState.activeTab` writable (stores). Toggle visibility per riga: due bottoni `org`/`team`.
- Produces: componente `<PendingPublishPanel />` montato su `appState.activeTab === 'shared'`.

- [ ] **Step 1: Installa lucide-svelte**

```bash
cd gui && npm install lucide-svelte && cd ..
```

Expected: `lucide-svelte` in `gui/package.json` dependencies.

- [ ] **Step 2: Aggiungi `'shared'` al type in `gui/src/lib/stores.svelte.ts:4`**

```typescript
  activeTab: 'search' as 'search' | 'timeline' | 'spatial' | 'graph' | 'predictions' | 'conflicts' | 'archive' | 'shared' | 'settings',
```

- [ ] **Step 3: Crea il pannello `gui/src/lib/components/PendingPublishPanel.svelte` (file completo, copia così com'è)**

```svelte
<script lang="ts">
  import { CloudUpload, RefreshCw, Check } from 'lucide-svelte';
  import { api, type SharedSuggestionDto } from '../api';
  import { appState } from '../stores.svelte';

  let suggestions = $state<SharedSuggestionDto[]>([]);
  let notConfigured = $state(false);
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let visibility = $state<Record<string, 'org' | 'team'>>({});
  let publishing = $state<Record<string, boolean>>({});
  let published = $state<Record<string, boolean>>({});
  let rowError = $state<Record<string, string>>({});

  function ageOf(suggestedAt: number): string {
    const hours = Math.floor((Date.now() - suggestedAt) / 3_600_000);
    if (hours < 1) return 'just now';
    if (hours === 1) return '1h ago';
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  async function load(): Promise<void> {
    loading = true;
    loadError = null;
    try {
      suggestions = await api.sharedSuggestions();
      notConfigured = false;
    } catch (e) {
      // Distinguish "shared not configured" from real errors via the test
      // endpoint (already exists in api.ts).
      try {
        const test = await api.sharedTest();
        if (!test.connected && (test.reason === 'not configured' || test.reason === 'disabled')) {
          notConfigured = true;
        } else {
          loadError = e instanceof Error ? e.message : String(e);
        }
      } catch {
        loadError = e instanceof Error ? e.message : String(e);
      }
    }
    loading = false;
  }

  async function publish(memoryId: string): Promise<void> {
    publishing = { ...publishing, [memoryId]: true };
    rowError = { ...rowError, [memoryId]: '' };
    try {
      await api.sharedPublish(memoryId, visibility[memoryId] ?? 'org');
      published = { ...published, [memoryId]: true };
      suggestions = suggestions.filter((s) => s.memoryId !== memoryId);
    } catch (e) {
      rowError = { ...rowError, [memoryId]: e instanceof Error ? e.message : String(e) };
    } finally {
      publishing = { ...publishing, [memoryId]: false };
    }
  }

  load();
</script>

<div class="max-w-3xl space-y-4">
  <div class="flex items-center justify-between">
    <div>
      <h2 class="text-lg font-semibold text-[var(--text-h)]">Shared — Pending publish</h2>
      <p class="text-xs text-[var(--text-muted)] mt-1">
        Promoted (L2/L3) memories awaiting your decision to publish to the team/org server.
      </p>
    </div>
    <button
      onclick={load}
      disabled={loading}
      class="p-2 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors disabled:opacity-50"
      title="Refresh"
    >
      <RefreshCw size={16} class={loading ? 'animate-spin' : ''} />
    </button>
  </div>

  {#if loading && suggestions.length === 0}
    <div class="text-sm text-[var(--text-muted)]">Loading…</div>
  {:else if notConfigured}
    <div class="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 text-center space-y-3">
      <CloudUpload size={24} class="mx-auto text-[var(--text-muted)]" />
      <p class="text-sm text-[var(--text)]">Shared memory is not configured.</p>
      <button
        onclick={() => (appState.activeTab = 'settings')}
        class="px-4 py-2 text-sm rounded-lg border border-[var(--border)] hover:bg-[var(--surface-hover)] transition-colors"
      >
        Open Settings
      </button>
    </div>
  {:else if loadError}
    <div class="text-sm text-yellow-400">Backend starting… ({loadError})</div>
  {:else if suggestions.length === 0}
    <div class="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 text-center">
      <p class="text-sm text-[var(--text-muted)]">
        Nothing pending — promoted memories will appear here for 24h.
      </p>
    </div>
  {:else}
    <div class="space-y-2">
      {#each suggestions as s (s.memoryId)}
        <div class="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex items-start gap-4">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <span class="px-1.5 py-0.5 rounded bg-[var(--accent-glow)] text-[var(--accent)]">
                L{s.level}
              </span>
              <span>{ageOf(s.suggestedAt)}</span>
            </div>
            <p class="text-sm text-[var(--text)] mt-1 line-clamp-2">{s.content}</p>
            {#if rowError[s.memoryId]}
              <p class="text-xs text-yellow-400 mt-1">{rowError[s.memoryId]}</p>
            {/if}
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <div class="flex rounded-lg border border-[var(--border)] overflow-hidden text-xs">
              {#each ['org', 'team'] as v (v)}
                <button
                  onclick={() => (visibility = { ...visibility, [s.memoryId]: v as 'org' | 'team' })}
                  class="px-2 py-1.5 capitalize transition-colors
                    {(visibility[s.memoryId] ?? 'org') === v
                      ? 'bg-[var(--accent-glow)] text-[var(--accent)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text)]'}"
                >
                  {v}
                </button>
              {/each}
            </div>
            <button
              onclick={() => publish(s.memoryId)}
              disabled={publishing[s.memoryId] || published[s.memoryId]}
              class="px-3 py-1.5 text-xs rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-1"
            >
              {#if published[s.memoryId]}
                <Check size={12} /> Published
              {:else}
                {publishing[s.memoryId] ? 'Publishing…' : 'Publish'}
              {/if}
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
```

- [ ] **Step 4: Wiring in `gui/src/App.svelte`**

Aggiungi l'import (riga ~11, con gli altri):
```svelte
  import PendingPublishPanel from './lib/components/PendingPublishPanel.svelte';
  import { CloudUpload } from 'lucide-svelte';
```

Aggiungi la voce nav nell'array (dopo `archive`, prima di `settings`):
```svelte
          { id: 'archive', label: 'Archive', icon: '📦' },
          { id: 'shared', label: 'Shared', icon: CloudUpload },
          { id: 'settings', label: 'Settings', icon: '⚙️' },
```

Il rendering della icona (il campo `icon` può ora essere stringa emoji o componente — il Task 5 converte tutto a componenti; per ora rendi entrambi):
```svelte
            {#if typeof tab.icon === 'string'}
              <span>{tab.icon}</span>
            {:else}
              {@const Icon = tab.icon}
              <Icon size={16} />
            {/if}
```
(sostituisce `<span>{tab.icon}</span>` a riga ~134)

Aggiungi il rendering del pannello (dopo `conflicts`, prima di `settings` ~riga 177):
```svelte
        {:else if appState.activeTab === 'shared'}
          <PendingPublishPanel />
```

- [ ] **Step 5: Build GUI**

```bash
cd gui && npm run build
```

Expected: build verde.

- [ ] **Step 6: Commit 2**

```bash
git add gui/package.json gui/package-lock.json gui/src/lib/api.ts gui/src/lib/stores.svelte.ts gui/src/App.svelte gui/src/lib/components/PendingPublishPanel.svelte
git commit -m "feat(gui): Shared pending-publish panel"
```

---

### Task 5: Sostituzione icone Lucide

**Files:**
- Modify: `gui/src/App.svelte` (nav array ~120-127)
- Modify: `gui/src/lib/components/MemoryCard.svelte:112-123`
- Modify: `gui/src/lib/components/SpatialMap.svelte:318-320`

**Interfaces:**
- Consumes: `lucide-svelte` (installato nel Task 4).
- Produces: nessuna interfaccia nuova (pure refactor visuale).

- [ ] **Step 1: Converti la nav in `App.svelte`**

Sostituisci l'array (~righe 120-127):
```svelte
        {#each [
          { id: 'search', label: 'Search', icon: Search },
          { id: 'timeline', label: 'Timeline', icon: Calendar },
          { id: 'spatial', label: 'Spatial Map', icon: Map },
          { id: 'graph', label: 'Concept Graph', icon: Network },
          { id: 'predictions', label: 'Predictions', icon: Sparkles },
          { id: 'conflicts', label: 'Conflicts', icon: Zap },
          { id: 'archive', label: 'Archive', icon: Archive },
          { id: 'shared', label: 'Shared', icon: CloudUpload },
          { id: 'settings', label: 'Settings', icon: Settings },
        ] as tab}
```

E gli import in cima al `<script>`:
```svelte
  import { Search, Calendar, Map, Network, Sparkles, Zap, Archive, CloudUpload, Settings } from 'lucide-svelte';
```
(`CloudUpload` è già importato nel Task 4 — non duplicare.)

Il blocco rendering icona del Task 4 (`typeof tab.icon === 'string'`) resta valido e compatibile.

- [ ] **Step 2: `MemoryCard.svelte`**

Import: `import { Pin, Pencil } from 'lucide-svelte';`

Riga ~113: `<span class="text-[var(--accent)]">📌 Pinned</span>` →
```svelte
            <span class="text-[var(--accent)] inline-flex items-center gap-1"><Pin size={12} /> Pinned</span>
```

Riga ~123 (il bottone edit): `✎` →
```svelte
          <Pencil size={12} />
```

- [ ] **Step 3: `SpatialMap.svelte`**

Import: `import { Pin } from 'lucide-svelte';`

Riga ~319: `<div class="text-amber-400 text-xs">📌 Pinned</div>` →
```svelte
          <div class="text-amber-400 text-xs flex items-center gap-1"><Pin size={12} /> Pinned</div>
```

- [ ] **Step 4: Verifica zero emoji residue**

```bash
rg -n "\p{Extended_Pictographic}" gui/src -g '*.svelte' -g '*.ts'
```

Expected: nessun output, exit 1 di rg ("no matches"). I simboli testuali come `✓`/`→` NON sono Extended_Pictographic e sono ammessi — se invece appare una vera emoji, è una dimenticanza: sostituila.

- [ ] **Step 5: Build GUI + commit 3**

```bash
cd gui && npm run build && cd ..
git add gui/src/App.svelte gui/src/lib/components/MemoryCard.svelte gui/src/lib/components/SpatialMap.svelte
git commit -m "refactor(gui): replace emoji with Lucide icons"
```

---

### Task 6: Verifica finale + push + PR

**Files:** nessuno — solo verifica e PR.

- [ ] **Step 1: Verifica completa**

```bash
npm run typecheck && npm test && npm run lint && npm run build && cd gui && npm run build && cd ..
```

Expected: tutto verde (flake adapter ammessi, verificare verdi in isolamento se falliscono).

- [ ] **Step 2: Push + PR verso dev**

```bash
git push -u origin feat/shared-gui
gh pr create --base dev --title "feat(gui): Shared pending-publish panel + Lucide icons" --body "Closes the GUI gap for the shared memory server: pending-publish panel consuming GET /api/shared/suggestions + POST /api/shared/publish, and Lucide monochrome icons replacing emoji. Spec: docs/superpowers/specs/2026-09-25-shared-publish-gui-design.md"
```
