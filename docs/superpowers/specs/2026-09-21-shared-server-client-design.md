# Shared Memory Server Client — Design

**Data:** 2026-09-21
**Stato:** approvato
**Specifica server:** `/Users/federicocesconi/Desktop/omnimind-client-integration.md` (endpoint di produzione verificato end-to-end il 2026-09-21)

## Obiettivo

Consentire al client Omnimind di connettersi a un server MCP remoto di memoria condivisa (team/org) per:

1. **Leggere** memoria condivisa rilevante per il contesto corrente (`shared_search`)
2. **Scrivere** item L2/L3 quando l'utente li promuove a team/org (`shared_publish`)
3. **Statistiche** (`shared_status`)

La memoria personale (L0–L3) resta sul client, invariata. Il server non sostituisce né replica il SQLite locale.

## Decisioni prese ( brainstorming )

| Domanda | Decisione |
|---|---|
| Scope | Completo: modulo client + tool MCP + contesto automatico + CLI + GUI |
| Publish | Esplicito + suggerimento (lista suggerimenti quando un item arriva a L2/L3) |
| Search | On-demand (tool/CLI) + automatico nel contesto (cache breve, timeout stretto) |
| Token | In chiaro nella tabella `settings` (come gli altri settings) |
| Transport | SDK ufficiale MCP (`Client` + `StreamableHTTPClientTransport`), transport iniettabile per i test |

## Architettura

### Modulo `src/shared/`

Il resto del client non deve sapere che esiste HTTP sotto.

- **`src/shared/types.ts`** — `SharedClientConfig` (`serverUrl`, `token`), `SharedSearchResult` (`item`, `score`, `matchType`), `SharedItem`, `SharedStatus` (`items`, `superseded`), interfaccia `SharedClient` con `search()`, `publish()`, `status()`. Tutto `Result<T, E>`, mai throw per fallimenti attesi.
- **`src/shared/McpSharedClient.ts`** — unica implementazione di `SharedClient`. Usa `Client` + `StreamableHTTPClientTransport` da `@modelcontextprotocol/sdk` (già dipendenza, v1.29). Transport **stateless**: ogni POST indipendente, nessun `Mcp-Session-Id`. Header `Authorization: Bearer <omt_...>`, `protocolVersion` negoziato `2025-03-26`. Il transport è opzionalmente iniettabile dal costruttore per i test (il codebase non usa `vi.mock` di moduli npm; si iniettano fake).

### Connessione (vincoli del server)

| Parametro | Valore |
|---|---|
| Endpoint | `https://omnimind-server-production.up.railway.app/mcp` (configurabile via settings) |
| Protocollo | MCP over StreamableHTTP stateless |
| Auth | `Authorization: Bearer <token omt_...>` (opaco, non JWT, non scadente) |
| Rate limit | 100 req/min per token → HTTP 429 |

### Wiring (`src/index.ts`)

- `Omnimind.create()` legge `sharedEnabled`, `sharedServerUrl`, `sharedToken` dalla tabella `settings` (pattern `nerEngine`, src/index.ts:156).
- Se abilitato e configurato → costruisce `McpSharedClient`; fallimento → `console.error('[SharedClient] ...')` e continua in solo-locale (pattern adapter bus, src/index.ts:177-199).
- Istanza esposta come proprietà readonly della facade (pattern `contextInjector`, src/index.ts:110).

### Tool MCP (`src/mcp/server.ts`)

Tre nuovi tool accanto agli 8 esistenti:

- `omnimind_shared_search` — `query_text?`, `limit?` (usa **solo `query_text`**: il server embedda da sé; non passiamo `query_vector` per non legare la ricerca condivisa all'embedding model locale)
- `omnimind_shared_publish` — `level` (2|3), `visibility` (team|org), `content`, `trust_weight?`, `workspace_id?` (obbligatorio se team), `metadata?`
- `omnimind_shared_status` — nessun argomento

Se il client non è configurato → risposta testuale "shared server not configured", non errore. Registrazione: Zod schema in cima + entry in `ListToolsRequestSchema` + case nello switch + handler privato (pattern esistente).

### Contesto automatico

- `Omnimind.getContextInjection()` (src/index.ts:701) appende un blocco `<omnimind_shared>` dopo `<omnimind_predictions>`.
- Cache in memoria: TTL 60s, chiave = fingerprint.
- Timeout ~4s; server non raggiungibile o non configurato → blocco omesso silenziosamente.
- Item con `supersededAt != null` esclusi prima di mostrarli.
- Il flusso passa anche per CLI `inject`, `/api/context` e GUI senza modifiche a quei punti.

### Suggerimento publish

- Quando `AgingPipeline` promuove un item a L2/L3, la facade lo aggiunge a una lista suggerimenti in memoria (max 20, TTL 24h).
- Visibile via `omnimind shared suggestions` e come riga `shared_suggestion` nel blocco `<omnimind_shared>` del contesto, così l'agente MCP può proporre la pubblicazione all'utente.
- La pubblicazione vera resta sempre un gesto esplicito.

### CLI (`src/cli.ts`, pattern `busCommand`)

- `omnimind shared config --url <url> --token <token> [--enable|--disable]`
- `omnimind shared status` — test connessione + statistiche
- `omnimind shared search <query> [--limit N]`
- `omnimind shared publish --id <memoryId> --visibility org|team [--workspace-id <uuid>]` — recupera `content`/`level` dal DB locale
- `omnimind shared suggestions` — lista suggerimenti pending

### GUI

- Sezione "Shared Memory Server" in `SettingsPanel.svelte`: toggle enabled, campi URL/token, bottone "Test connection".
- `gui/src/lib/api.ts`: nuovi metodi per la sezione.
- Endpoint `GET /api/shared/test` in `src/server.ts` → esegue `shared_status` remoto → `{connected: true, items, superseded}` oppure `{connected: false, reason}`.

## Error handling

| Condizione | Comportamento |
|---|---|
| 401 | Nessun retry; log + `lastSharedError` nei settings; funzionalità condivisa considerata disattivata finché l'utente non aggiorna il token. Locale invariato |
| 429 / 5xx transitori | Retry con backoff esponenziale, max 2 tentativi |
| Timeout / rete assente | `err` silenzioso; fallback solo-locale senza errori visibili (requisito PRD) |
| Risposte malformed | `err`; mai throw oltre il confine del modulo |

## Testing

- `tests/shared/McpSharedClient.test.ts` — fake transport iniettato: protocollo (initialize, header auth, protocolVersion), parsing risultati, retry su 429/5xx, no-retry su 401, timeout, resilienza a risposte malformed.
- `tests/shared/sharedIntegration.test.ts` — facade `Omnimind` con fake transport: blocco `<omnimind_shared>` nel contesto, cache TTL, omissione blocco su errore, suggerimenti da aging, nessuna regressione con client assente.
- Test CLI/endpoint secondo convenzioni esistenti (tmp dir, in-memory SQLite).
- Soglie coverage invariate: 80% linee/funzioni, 70% branch.

## Fuori scope

- Sincronizzazione bidirezionale (il server è un layer di sola promozione, non replica il locale)
- Cifratura del token a riposo
- Auto-publish senza gesto utente
- Passaggio di `query_vector` (spazio vettoriale locale ≠ necessario; il server embedda da sé)
