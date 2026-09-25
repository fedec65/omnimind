# Design — Pannello "Shared" (pending publish) + icone Lucide

- **Data:** 2026-09-25
- **Stato:** approvato (design presentato e approvato dall'utente)
- **Repo:** fedec65/omnimind (client), branch futuro da `dev`
- **Contesto:** chiude il gap GUI segnalato nell'integrazione col server condiviso (`omnimind_server`). Oggi il publish su shared server è possibile solo via MCP (`omnimind_shared_publish`) o CLI (`omnimind shared publish`); la GUI può solo configurare/testare la connessione. In aggiunta, sostituzione delle emoji nella GUI con icone minimaliste monocolore.

## Obiettivi

1. Rendere il flusso "pubblica memoria promossa (L2/L3) sul server condiviso" accessibile dalla GUI.
2. Sostituire tutte le emoji della GUI con icone Lucide monocolore.

## Non-obiettivi (out of scope)

- Ricerca sul server condiviso dalla GUI (`shared search`) — futuro, il pannello è progettato per ospitarla.
- Modifica del server remoto `omnimind_server` — qui si lavora solo sul client.
- Autenticazione/gestione token — resta come oggi (Settings → Shared Memory Server).
- Cambi di stile oltre alla sostituzione delle icone.

## A. Endpoints HTTP (`src/server.ts`)

Accanto all'esistente `/api/shared/test` (riga ~482), due endpoint nello stesso stile (`node:http` puro, `sendJson`, nessun throw):

### `GET /api/shared/suggestions`

- Ritorna le pending suggestions: `omni.getSharedSuggestions()` →
  `200 [{ memoryId, content, level, suggestedAt }]`
- `503 { error: 'not ready' }` se `omni` è null (engine ancora in init — pattern esistente negli altri endpoint).
- Se il shared server non è configurato: `200 []` (il pannello mostra lo stato "not configured" lato client verificando via `/api/shared/test` o un campo `configured` — vedi §B).

### `POST /api/shared/publish`

- Body: `{ id: string, visibility: 'org' | 'team', workspaceId?: string }`, validato con Zod (convenzione repo) o controlli manuali come `/api/settings`.
- Chiama `omni.publishMemoryToShared(id, { visibility, ... })`.
- Risposte:
  - `200 { ok: true, sharedId }` su successo (il metodo facade ritorna il risultato del client shared).
  - `400 { error }` body malformato o visibility invalida.
  - `404 { error }` memory inesistente o non L2/L3 (il facade ritorna errore — mappato, non throw).
  - `503 { error: 'shared not configured' }` se `omni.sharedAvailable()` è false.
- Il facade già: cancella la suggestion da SQLite + memoria, invalida la shared cache (fix 0.8.4).

## B. GUI — nuovo tab "Shared" (`PendingPublishPanel.svelte`)

### Navigazione

- `gui/src/lib/stores.svelte.ts`: aggiungere `'shared'` al type `activeTab`.
- `gui/src/App.svelte:120-127`: voce `{ id: 'shared', label: 'Shared', icon: ... }` — icona Lucide `CloudUpload`; rendering `{:else if appState.activeTab === 'shared'} <PendingPublishPanel />`.

### Pannello `gui/src/lib/components/PendingPublishPanel.svelte`

- **Fetch all'apertura + refresh manuale** (`RefreshCw`): `GET /api/shared/suggestions`.
- **Stati:**
  - Lista suggestions: ogni riga mostra preview content (truncata ~2 righe), badge layer (L2 Concept / L3 Wisdom), età (es. "3h ago"), pulsante **Publish**.
  - Scelta visibility: default `org`; due piccoli bottoni toggle `org` / `team` per riga.
  - Per riga: stato `publishing…` / `✓ published` / errore (testo errore).
  - Empty states distinti:
    - `[]` + shared configurato → "Nothing pending — promoted memories will appear here."
    - shared non configurato → "Shared memory is not configured." + bottone "Open Settings" (switcha tab settings).
    - Determinazione "configurato": chiamata `GET /api/shared/test` (già esistente) o prima chiamata suggestions + flag — preferenza: usare `/api/shared/test` (reason `not configured`/`disabled`).
  - Errore engine (503): messaggio "Backend starting…" con retry.
- **Dopo publish riuscito:** la riga esce dalla lista (refresh dopo la chiamata — la suggestion è già stata cancellata lato server).

### `gui/src/lib/api.ts`

- `sharedSuggestions(): Promise<SharedSuggestionDto[]>` — GET `/api/shared/suggestions`.
- `sharedPublish(id, visibility, workspaceId?): Promise<{ ok: boolean; sharedId?: string }>` — POST `/api/shared/publish`.
- DTO types esportati nello stesso file (convenzione esistente).

## C. Icone Lucide (sostituzione emoji)

- **Nuova dipendenza:** `lucide-svelte` in `gui/package.json` (tree-shakeable, stroke monocolore 24px).
- **Sidebar (`App.svelte`):**

  | Tab | Emoji | Icona Lucide |
  |---|---|---|
  | Search | 🔍 | `Search` |
  | Timeline | 📅 | `Calendar` |
  | Spatial Map | 🗺️ | `Map` |
  | Concept Graph | 🕸️ | `Network` |
  | Predictions | 🔮 | `Sparkles` |
  | Conflicts | ⚡ | `Zap` |
  | Archive | 📦 | `Archive` |
  | Shared (new) | — | `CloudUpload` |
  | Settings | ⚙️ | `Settings` |

  Refactor minimo: la nav array diventa oggetti con `icon: Component` invece di stringa; rendering `<tab.icon size={16} />`.
- **Altre emoji:**
  - `MemoryCard.svelte:113` 📌 → `Pin` (size 12, stesso colore accent).
  - `MemoryCard.svelte:123` ✎ → `Pencil` (size 12).
  - `SpatialMap.svelte:319` 📌 → `Pin` + testo "Pinned".
- **Colore:** default `text-[var(--text-muted)]`; attive `text-[var(--accent)]` (ereditano tema, monocolore garantito). Attive-in-nav: usa `text-[var(--accent)]` già presente nella classe condizionale.
- Verifica finale: `grep -rP "\p{Extended_Pictographic}" gui/src` deve ritornare vuoto (⚠️ attenzione a caratteri tipo `✓`/`→` in testi: quelli sono simboli testuali, non emoji — ammessi).

## D. Test

- **`tests/server/SharedPublishEndpoint.test.ts`** (pattern `SharedTestEndpoint.test.ts`):
  - Spawn `dist/server.js` con `OMNIMIND_DATA_DIR` temp; seed del DB via `better-sqlite3` prima dello spawn: 1 memory L2 + riga `shared_suggestions` + settings sharedEnabled/url/token (fake shared server HTTP echo come nell'esistente).
  - `GET /api/shared/suggestions` → 200, lista con 1 elemento coerente.
  - `POST /api/shared/publish` body valido → fake shared server riceve la chiamata; response ok; `GET /api/shared/suggestions` dopo → lista vuota (row cancellata — verifica anche su DB).
  - Body invalido (visibility sbagliata / id mancante) → 400.
  - Publish con shared disabilitato → 503.
- **GUI:** nessun test esistente in `gui/` → nessun test GUI (convenzione repo).
- Suite completa: attenzione ai noti flake adapter sotto carico (verde in isolamento).

## E. Convenzioni e commit

- TS strict + `exactOptionalPropertyTypes`, import `.js`, `Result` mai throw, test con temp dir + SQLite.
- Commit separati:
  1. `feat(server): GET /api/shared/suggestions + POST /api/shared/publish` (+ test)
  2. `feat(gui): Shared pending-publish panel` (panello + api.ts + wiring nav/store)
  3. `refactor(gui): replace emoji with Lucide icons` (sidebar + card + spatial map)
- Verifica finale per commit: `npm run typecheck && npm test && npm run lint && npm run build && cd gui && npm run build`.
- PR verso `dev`.

## Note

- Le suggestions esistono solo quando il client shared è configurato (`noteSharedSuggestion` ritorna precoce se `shared === null`) — motivo dell'empty state "not configured" lato GUI.
- Il publish dalla GUI mantiene la semantica esplicita: azione utente diretta, come MCP/CLI.
