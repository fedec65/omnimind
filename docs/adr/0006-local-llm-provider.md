# ADR: Local LLM Provider for Omnimind

**Status:** Proposed
**Date:** 2026-10-05
**Deciders:** Project maintainers
**Supersedes:** —

## Context

Omnimind currently has zero LLM dependency at runtime. Embeddings use a local ONNX model (`all-MiniLM-L6-v2`, 384-dim). Text summarization in the aging pipeline (L0→L1, L2→L3) is rule-based. NER uses either a heuristic extractor or an opt-in ONNX model (`dslim/bert-base-NER`).

Users with a local LLM running on their machine (Ollama, LM Studio) have asked whether they can plug their model into Omnimind. The codebase grep confirms no current integration: zero matches for `ollama` or `lmstudio` anywhere in source, tests, or planning docs.

Adding a local LLM is consistent with Omnimind's "100% local" positioning — the user's inference already runs on their machine, and integrating it preserves that boundary. It also creates an upgrade path for the existing rule-based summarization and heuristic NER, both of which are known weak spots.

## Decision

Add a small, isolated `LLMProvider` interface with two implementations (`OllamaProvider`, `LMStudioProvider`) and a default `NullProvider`. Expose the provider as a getter on `Omnimind` (swappable), one new MCP tool (`omnimind_summarize`), and a GUI Settings card that toggles the provider at runtime with SQLite persistence.

The provider is **off by default**. Fresh installs ship with `NullProvider`. Users opt in via:
- GUI Settings → Local LLM (persisted in the existing `settings` SQLite table, applied at runtime via `reloadLLM()`)
- `omnimind config llm enable` (same table, same runtime path)
- Env vars at boot (fallback only; GUI/CLI settings override at next boot)

A `guard.assertLoopback()` refuses any non-loopback URL at construction time, blocking cloud fallback paths.

## Rationale

- **Off by default** preserves the "zero API calls" promise for users who don't opt in. No surprise network behavior.
- **GUI toggle + SQLite persistence** mirrors the existing `sharedEnabled`/`sharedServerUrl`/`sharedToken` pattern (`src/index.ts:911 reloadShared()`, `src/server.ts:486`). Users have one consistent mental model for "optional integration."
- **Runtime swap via `reloadLLM()`** matches `reloadShared()`. The provider field is a getter, not a final field. Toggling in the GUI takes effect without an app restart.
- **Loopback guard** is the loud refusal mechanism. If a user (or a misconfigured script) tries to point Omnimind at `https://api.openai.com`, construction fails with a `config` error rather than silently proxying data to the cloud.
- **Isolated module** (`src/core/llm/`) keeps the surface area small and reversible. If we ever want to remove the feature, we delete one directory.
- **No SDK dependencies** — `node:http` only, matching `src/server.ts` and avoiding supply-chain risk on third-party SDKs.
- **One MCP tool** keeps the integration testable and the cognitive load low. Future integrations (NER, prediction, aging) get their own brainstorming cycles and their own specs.

## Consequences

### Positive

- New opt-in feature for power users with local LLMs.
- Toggleable from the GUI; persists across restarts; works without an app restart after first boot.
- Mirrors the existing `shared*` config pattern, so users already familiar with Omnimind's optional services (shared memory server) understand it instantly.
- Clean extension point (`LLMProvider` interface) for future providers (llama.cpp, vLLM, etc.).
- Sets up future work on LLM-backed summarization, NER, and query rewriting without committing to those designs now.
- Documentation win: shows that "local-only" can absorb new features without breaking the principle.

### Negative

- New test surface to maintain (provider HTTP mocks, guard cases, MCP integration, settings round-trip, GUI endpoint).
- New CLI commands + GUI card to design and document.
- Two config sources (SQLite + env vars) need a documented precedence rule (SQLite wins after first save; env is first-boot fallback).
- Users on machines without 8GB+ RAM and a local LLM runtime won't benefit; this feature is for a subset of users.

### Neutral

- Provider responses aren't streamed in MVP. If latency becomes a complaint, add streaming later without changing the interface.
- No persistence of LLM config in SQLite. Env-var + process-arg model matches the existing `shared*` config pattern.

## Alternatives considered

1. **Wire the LLM directly into `AgingPipeline` summarization.**
   Rejected for this spec. The aging pipeline is the most behaviorally critical code path; coupling it to a new external dependency needs its own brainstorming, with explicit failure-mode analysis (what happens when the LLM times out mid-batch? what if it hallucinates a fake filename?). Out of scope here.

2. **Use the `ollama` npm SDK instead of raw `node:http`.**
   Rejected. The SDK adds dependency surface, a new maintainer to trust, and version churn. The Ollama HTTP API is small and stable. `node:http` is already used in `src/server.ts` so the pattern is consistent.

3. **Auto-detect running LLMs at startup.**
   Rejected. Magic is the wrong default for a privacy-first tool. The user knows whether they have Ollama running; make them opt in.

4. **Allow cloud LLM providers behind a feature flag.**
   Rejected. The loopback guard is the project's loud refusal. If a future spec wants cloud, it must explicitly amend this ADR. Don't bake a backdoor in now.

5. **Expose only the `LLMProvider` interface publicly, no MCP tool.**
   Rejected. The MCP tool is the natural integration point for Omnimind's primary use case (AI assistants pulling context). Without it, the feature has no surface where users actually benefit.

6. **Env-only, no GUI toggle, no SQLite persistence.**
   This was the original MVP. Rejected in favor of the GUI toggle because: (1) env vars force a restart on every change; (2) the existing `shared*` config already sets the pattern of GUI-toggled services; (3) users who find Omnimind via the app (not the CLI) have no surface to enable an LLM. The cost (~5h more work) is small relative to the UX win.

## Implementation

See `docs/superpowers/specs/2026-10-05-local-llm-provider-design.md` for the full design, including file-by-file change list, testing strategy, and acceptance criteria. Implementation plan will be produced via the writing-plans skill after this spec is approved.

Estimated scope: ~17-19h of focused work. MVP only — does not include aging/prediction/NER integration, which are separate specs.

## References

- `src/index.ts` — `Omnimind` class, `OmnimindConfig`, `reloadShared()` (the pattern `reloadLLM()` mirrors)
- `src/server.ts:456-494` — `/api/settings` GET/POST with per-key writes (the route `reloadLLM()` plugs into)
- `src/core/MemoryStore.ts:140-144, 1642-1691` — `settings` table + `getSetting`/`setSetting`/`getAllSettings`
- `src/core/ner/NerEngine.ts` — existing `heuristic | onnx` selector pattern to mirror
- `src/layers/AgingPipeline.ts` — current rule-based summarization target for future spec
- `src/server.ts` — `node:http` pattern reference
- `src/mcp/server.ts` — MCP tool registration pattern reference
- `gui/src/lib/components/SettingsPanel.svelte:24-50` — existing settings form fields (`sharedEnabled`, etc.) that the LLM card slots next to
- `AGENTS.md` — `Result<T,E>`, interface conventions, log prefixes

## References

- `src/index.ts` — `Omnimind` class, `OmnimindConfig` definition
- `src/core/ner/NerEngine.ts` — existing `heuristic | onnx` selector pattern to mirror
- `src/layers/AgingPipeline.ts` — current rule-based summarization target for future spec
- `src/server.ts` — `node:http` pattern reference
- `src/mcp/server.ts` — MCP tool registration pattern reference
- `AGENTS.md` — `Result<T,E>`, interface conventions, log prefixes