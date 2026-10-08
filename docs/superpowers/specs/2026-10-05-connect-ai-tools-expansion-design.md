# Expand "Connect AI Tools" Registry — Design

**Date:** 2026-10-05
**Status:** Draft — awaiting review
**Scope:** Add OpenAI Codex CLI, VS Code (Copilot agent), Continue to MCP client registration. Show research-backed "not supported yet" entries for DeepSeek, Z.ai, Grok, Muse. Fix the existing Claude Code user-scope path bug.

## Background

`src/setup/mcpSetup.ts` defines `MCP_CLIENTS`, the registry the GUI "Connect AI Tools" panel reads via `/api/setup/clients` (`src/server.ts:632`) and `omnimind setup` writes to. Today it has 4 entries:

| ID | Name | Config path |
|---|---|---|
| `claude-code` | Claude Code | `~/.claude/settings.json` |
| `cursor` | Cursor | `~/.cursor/mcp.json` |
| `claude-desktop` | Claude Desktop | `<platform>/Claude/claude_desktop_config.json` |
| `kimi` | Kimi Code | `~/.kimi-code/mcp.json` |

A research pass on 2026-10-05 against official vendor docs (`docs.claude.com`, `cursor.com`, `modelcontextprotocol.io`, Moonshot's `kimi-code` repo, OpenAI's Codex `developers.openai.com`, VS Code docs, Continue's GitHub) found:

1. **Claude Code user-scope MCP is actually `~/.claude.json`, not `~/.claude/settings.json`.** Project-scope is `.mcp.json` / `.claude/settings.json`. The existing code uses project-scope path for user-scope, which works for some users and breaks for others.
2. **OpenAI Codex CLI** supports MCP via TOML `~/.codex/config.toml` with `[mcp_servers.<id>]` tables.
3. **VS Code (Copilot agent)** supports MCP via per-project `.vscode/mcp.json` with `mcpServers`. User-scope is also supported but the conventional path is project-level.
4. **Continue** supports MCP via `~/.continue/config.json` with `mcpServers`.
5. **DeepSeek, Z.ai (GLM), xAI Grok, Muse** have no public MCP client/app as of 2026-10-05. DeepSeek ships an OpenAI/Anthropic-compatible API only; Z.ai's "GLM Coding Plan" is a model subscription you point at existing tools; Grok is consumer web chat + API only; Muse is not an AI coding tool (Lightricks has no Muse product; the "Muse" consumer apps from Meta and others are personal-assistant products with no MCP host).

## Goal

Make "Connect AI Tools" reflect what is actually supported in the ecosystem today, with honest signaling where support is missing.

## Design

### 1. Fix Claude Code user-scope path

**Decision:** Write to BOTH `~/.claude.json` AND `~/.claude/settings.json` for Claude Code registration. The former is the documented user-scope per Anthropic; the latter is project-scope and a no-op write when the file doesn't exist. Both writes are idempotent and atomic.

This avoids breaking any existing install while fixing the canonical case. Detection logic (`detectPaths`) adds `~/.claude.json` to the list of paths whose existence indicates Claude Code is installed.

### 2. Add `codex` (OpenAI Codex CLI)

```ts
{
  id: 'codex',
  name: 'OpenAI Codex CLI',
  configPath: (home) => join(home, '.codex', 'config.toml'),
  detectPaths: (home) => [join(home, '.codex')],
}
```

TOML parser needed. Two options:

- **(a)** Hand-roll a focused parser for the `[mcp_servers.<id>]` table only (~80 LOC). Pros: no dependency. Cons: only handles TOML features Codex actually uses.
- **(b)** Add `smol-toml` as a dependency (~150KB, zero-deps). Pros: full TOML coverage. Cons: new dependency, must run `npm audit`.

**Decision:** (b) `smol-toml`. It is the smallest safe TOML parser in the npm registry, zero deps, actively maintained. Risk accepted.

### 3. Add `vscode` (VS Code + Copilot agent)

```ts
{
  id: 'vscode',
  name: 'VS Code (Copilot)',
  configPath: (home, platform) => vscodeMcpPath(home, platform),
  detectPaths: (home, platform) => [vscodeMcpPath(home, platform)],
}
```

**Path per OS:**
- macOS: `~/Library/Application Support/Code/User/mcp.json`
- Linux: `~/.config/Code/User/mcp.json`
- Windows: `%APPDATA%/Code/User/mcp.json`

**Scope question:** VS Code's MCP docs put `mcp.json` at workspace scope (`.vscode/mcp.json`) by default, with user-scope as a separate `mcp.json` at the user data dir above. We register at user-scope (so the user gets Omnimind across all workspaces). If the file doesn't exist on a fresh install, we create it under the User dir.

### 4. Add `continue` (Continue extension)

```ts
{
  id: 'continue',
  name: 'Continue',
  configPath: (home) => join(home, '.continue', 'config.json'),
  detectPaths: (home) => [join(home, '.continue')],
}
```

JSON `mcpServers` — same shape as Cursor/Kimi/Claude Desktop. Existing JSON helpers work.

### 5. "Not supported yet" entries

Add a new field on `McpClient` to flag unsupported entries:

```ts
export interface McpClient {
  readonly id: string;
  readonly name: string;
  readonly configPath: (home: string, platform: NodeJS.Platform) => string;
  readonly detectPaths: (home: string, platform: NodeJS.Platform) => string[];
  readonly supported: boolean;          // NEW. Defaults to true.
  readonly notes?: string;             // NEW. Shown in UI when !supported.
  readonly trackingUrl?: string;         // NEW. Link to GitHub issue.
}
```

Add four unsupported entries:

```ts
{ id: 'deepseek', name: 'DeepSeek', supported: false,
  notes: 'DeepSeek does not provide a local MCP client or desktop app with a config file.',
  trackingUrl: 'https://github.com/MoonshotAI/omnimind/issues/<new>' },
{ id: 'zai', name: 'Z.ai (GLM)', supported: false,
  notes: 'Z.ai is a model subscription. Point Claude Code, Cline, or other MCP hosts at it instead.',
  trackingUrl: '...' },
{ id: 'grok', name: 'xAI Grok', supported: false,
  notes: 'xAI Grok has no public MCP host or coding CLI.',
  trackingUrl: '...' },
{ id: 'muse', name: 'Muse', supported: false,
  notes: 'Muse is not an AI coding tool. No MCP host exists.',
  trackingUrl: '...' },
```

These contribute `id`, `name`, `supported: false`, `notes`, `trackingUrl`. Their `configPath` and `detectPaths` are no-op functions that return empty strings.

The GUI panel (`SettingsPanel.svelte`) checks `supported` and renders accordingly:
- `true` → existing toggle (Register / Unregister / Status)
- `false` → greyed-out card with "Not supported yet" badge + `notes` text + link to `trackingUrl`

CLI (`omnimind setup`) lists them with `(not supported)` suffix and skips the write.

### 6. TOML writer for Codex

`src/setup/tomlWriter.ts` (~80-120 LOC):

```ts
export function readTomlConfig(path: string): Result<TomlConfig, Error>;
export function writeTomlConfig(path: string, config: TomlConfig): Result<void, Error>;
export function ensureMcpServer(config: TomlConfig, id: string, entry: McpServerEntry): TomlConfig;
export function removeMcpServer(config: TomlConfig, id: string): TomlConfig;
```

Wraps `smol-toml` for parse/serialize. Implements idempotent insert/remove keyed on the `id` passed to `buildEntry()`. Codex's MCP table name is `mcp_servers` (TOML snake_case), entries are named sub-tables: `[mcp_servers."omnimind"]`.

Atomic write via tmp+rename (matches the existing JSON writer pattern at `mcpSetup.ts:131-`).

### 7. Update `McpClientId` type

Today: `'claude-code' | 'cursor' | 'claude-desktop' | 'kimi'`.

Becomes: adds `'codex' | 'vscode' | 'continue'` plus `'deepseek' | 'zai' | 'grok' | 'muse'` for the unsupported ones.

`getClient()` and `isClientConfigured()` work as-is (they iterate `MCP_CLIENTS`). `validIds` set in `src/server.ts:644` picks up new entries automatically.

### 8. File-by-file change list

| File | Action | Approx LOC |
|---|---|---|
| `src/setup/mcpSetup.ts` | EDIT — add 7 entries, fix Claude Code dual-write, add `supported`/`notes`/`trackingUrl` fields | +60 |
| `src/setup/tomlWriter.ts` | NEW — TOML read/write helpers | +120 |
| `tests/setup/tomlWriter.test.ts` | NEW — round-trip, idempotency, atomic write | +150 |
| `tests/setup/mcpSetup.test.ts` | EDIT — add coverage for new entries + Claude Code dual-write | +80 |
| `package.json` | EDIT — add `smol-toml` dependency | +1 |
| `src/server.ts` | EDIT — `/api/setup/clients` response now includes `supported`/`notes`/`trackingUrl` | +5 |
| `gui/src/lib/components/SettingsPanel.svelte` | EDIT — render unsupported entries as greyed-out cards | +50 |
| `gui/src/lib/api.ts` | EDIT — extend `McpClientStatus` type | +10 |
| `docs/USAGE.md` | EDIT — list newly supported tools | +30 |
| `README.md` | EDIT — update "Connect AI Tools" mention if needed | +5 |

Estimated total: ~500 LOC, ~6-8h of focused work including tests.

### 9. Risks

1. **Codex TOML schema drift.** If OpenAI renames `mcp_servers` or changes the entry shape, our writer breaks. Mitigation: pin `smol-toml`, add a focused parser test that mirrors the actual Codex schema, document the dependency.
2. **VS Code multi-OS paths.** `Library/Application Support/Code/User` on macOS vs `~/.config/Code/User` on Linux vs `%APPDATA%/Code/User` on Windows. Tested with platform injection (matches existing pattern).
3. **Claude Code dual-write ordering.** If one write fails after the other succeeded, we have partial state. Mitigation: writes are idempotent, a re-run fixes it. Document in tooltips.
4. **Muse / DeepSeek entries might confuse users** ("why is it listed if it doesn't work?"). Mitigation: clear badge + notes + tracking URL. They become live entries once support ships.

### 10. What this spec does NOT cover

- Per-workspace Claude Code project-scope `.mcp.json` writes (could be a follow-up; today we only touch user-scope).
- JetBrains, OpenHands, Cody (different scope shapes, UI-managed). Separate spec.
- Aider (no MCP at all upstream).
- ChatGPT desktop (UI-managed, not file-based).
- Adding `McpClient` entries for **adapters** (ChatGPTAdapter, ClaudeDesktopAdapter) — those are bus adapters, a separate system.

## Acceptance criteria

1. `npm run typecheck` passes with the expanded `McpClientId` union.
3. `npm test` passes; coverage thresholds met; `tomlWriter.test.ts` covers parse/serialize/idempotency/atomic-write/Codex-shaped fixtures.
2. `npm run lint` passes.
3. `npm run build` succeeds.
4. On macOS with all four new tools installed in their default locations, `omnimind setup --targets codex,vscode,continue,electron` registers them all atomically.
5. Running setup twice in a row is a no-op on the second call (idempotency).
6. The GUI Settings panel shows Claude Code, Cursor, Claude Desktop, Kimi Code, Codex CLI, VS Code (Copilot), Continue as toggleable. DeepSeek, Z.ai, Grok, Muse appear with a "Not supported yet" badge and link.
7. `omnimind setup --help` lists the new targets with their display names.