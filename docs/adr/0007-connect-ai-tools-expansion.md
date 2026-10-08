# ADR: Expand MCP Client Registry for "Connect AI Tools"

**Status:** Proposed
**Date:** 2026-10-05
**Deciders:** Project maintainers

## Context

`src/setup/mcpSetup.ts` defines `MCP_CLIENTS` — the registry the GUI "Connect AI Tools" panel and `omnimind setup` use to register Omnimind's MCP server in supported AI coding tools. Four entries exist today: `claude-code`, `cursor`, `claude-desktop`, `kimi`.

Users asked to add OpenAI Codex, VS Code (Copilot), Continue, DeepSeek, Z.ai, Grok, Muse.

A research pass on 2026-10-05 against official vendor docs found:

- **OpenAI Codex CLI** supports MCP via `~/.codex/config.toml` (TOML, `[mcp_servers.<id>]` tables). Documented and stable.
- **VS Code (Copilot agent)** supports MCP via `.vscode/mcp.json` (project scope) and a User-scope `mcp.json`. Documented and stable.
- **Continue** supports MCP via `~/.continue/config.json` (JSON `mcpServers`). Documented and stable.
- **DeepSeek, Z.ai, xAI Grok, Muse** have **no public MCP client/app** as of 2026-10-05. Adding them to a registration flow today would be dishonest.

A separate issue surfaced: the existing Claude Code entry writes to `~/.claude/settings.json`, but Anthropic's docs place user-scope MCP servers in `~/.claude.json`. The current code works for project-scope users and silently fails for user-scope users.

## Decision

1. **Fix Claude Code user-scope** by writing to both `~/.claude.json` and `~/.claude/settings.json`. Idempotent, safe for existing installs.
2. **Add Codex CLI** with a new `smol-toml`-backed TOML writer for `~/.codex/config.toml`. JSON helpers do not cover Codex's format.
3. **Add VS Code (Copilot)** with the standard user-scope `mcp.json` path per OS (Library/Application Support on macOS, ~/.config on Linux, %APPDATA% on Windows).
4. **Add Continue** with `~/.continue/config.json`. Reuses existing JSON helpers.
5. **Add DeepSeek, Z.ai, Grok, Muse as `supported: false`** entries with `notes` and `trackingUrl`. UI shows them as a "Not supported yet" card. Honest signaling.
6. **Introduce `smol-toml`** as the only new dependency. Smallest zero-dep TOML parser in the npm registry.

## Rationale

- **Adding the three documented tools** matches user demand and reflects the real ecosystem today. Codex is one of the fastest-growing CLI tools in 2026; VS Code + Copilot is the dominant editor; Continue is the leading open-source extension.
- **Showing unsupported tools with honest labels** is better than hiding them or pretending support exists. Users learn that we are tracking these, and clicking through to the tracking issue lets them subscribe.
- **Dual-write for Claude Code** is the smallest safe fix for a bug that affects existing installs. Pure replacement risks regressions; pure addition leaves the bug. Dual-write is idempotent and self-healing.
- **`smol-toml`** keeps the dependency surface minimal: zero transitive deps, audited upstream, ~150KB. Hand-rolling a TOML parser is tempting but risks bugs at the boundary with Codex's actual schema.

## Consequences

### Positive

- Reflects the real 2026 ecosystem in the GUI and CLI.
- Honest signaling for tools that don't yet support MCP.
- Fixes the Claude Code user-scope install bug.
- Sets up a clean pattern (`supported` flag) for future tool evaluation.

### Negative

- One new dependency (`smol-toml`). Bounded surface.
- TOML writer is a new file that needs tests against real Codex schemas.
- Adding `supported: false` entries adds UI complexity in `SettingsPanel.svelte`.

### Neutral

- Aider, JetBrains, Cody, OpenHands are explicitly out of scope. Each can be a follow-up spec.
- We do not change any `MemoryBus` adapter; this is registration-only.

## Alternatives considered

1. **Add all 7 mentioned tools as if they were supported.**
   Rejected. DeepSeek/Z.ai/Grok/Muse have no MCP host. Shipping entries that "register" them would silently no-op and mislead users.

2. **Hand-roll the TOML parser instead of `smol-toml`.**
   Considered. Rejected because Codex's TOML schema has features (multi-line strings, dotted keys) that hand-rolling tends to get wrong. `smol-toml` is small enough that the cost is acceptable.

3. **Per-project `.vscode/mcp.json` only (no user-scope).**
   Rejected. Project-scope means every repo the user opens needs `.vscode/mcp.json` checked in. That contradicts Omnimind's user-scope model where the user installs once and gets it everywhere.

4. **Wait for Claude Code user-scope behavior to stabilize before fixing.**
   Rejected. The bug is real today. Dual-write costs nothing and self-heals.

5. **Skip the "not supported" entries entirely.**
   Rejected. Users search for them; showing "DeepSeek — not supported yet" is more useful than making them wonder whether Omnimind supports their tool.

## Implementation

See `docs/superpowers/specs/2026-10-05-connect-ai-tools-expansion-design.md` for full design and acceptance criteria.

Estimated scope: ~500 LOC, ~6-8h. Implementation plan will be produced via the writing-plans skill after this spec is approved.

## References

- `src/setup/mcpSetup.ts:57-82` — current `MCP_CLIENTS` array
- `src/server.ts:631-649` — `/api/setup/clients` HTTP endpoint
- `gui/src/lib/components/SettingsPanel.svelte` — Connect AI Tools UI
- [Claude Code MCP docs](https://docs.claude.com/en/docs/claude-code/mcp)
- [Cursor MCP docs](https://cursor.com/docs/context/mcp)
- [Codex config reference](https://developers.openai.com/codex/config-reference)
- [VS Code MCP docs](https://code.visualstudio.com/docs/copilot/customization/mcp-servers)
- [Continue MCP](https://github.com/continuedev/continue)
- [Kimi MCP docs](https://github.com/MoonshotAI/kimi-code)