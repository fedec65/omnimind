#!/usr/bin/env node
/**
 * setup-claude-code — Idempotently write the Omnimind MCP server entry
 * into the user's Claude Code settings (~/.claude/settings.json).
 *
 * Usage: `npx omnimind setup-claude-code`
 *
 * Design choices:
 * - Pure functions exported for testability.
 * - Atomic write via tmp+rename prevents half-written config.
 * - 0o600 file mode matches the project's privacy posture (settings
 *   can contain user-specific paths; no need for group/world access).
 * - parseSettings is tolerant of malformed JSON (returns {}).
 * - `if (import.meta.url === ...)` guard allows tests to import the
 *   module without triggering main().
 * - OMNIMIND_DRY_RUN=1 prints the would-be write to stdout and exits
 *   without touching disk — used by the e2e test.
 * - OMNIMIND_CLAUDE_SETTINGS_PATH overrides the target file path —
 *   used by the e2e test to point at a temp file instead of the
 *   user's actual ~/.claude/settings.json.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
  renameSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface ClaudeSettings {
  mcpServers?: Record<string, McpServerEntry>;
  [key: string]: unknown;
}

/** The MCP server entry Omnimind installs for Claude Code. */
export function buildEntry(): McpServerEntry {
  return { command: 'npx', args: ['omnimind-mcp'] };
}

/**
 * Parse a Claude settings JSON string. Tolerant: returns {} for
 * empty input or malformed JSON so a half-written existing file
 * does not block setup.
 */
export function parseSettings(text: string): ClaudeSettings {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as ClaudeSettings;
  } catch {
    return {};
  }
}

/**
 * Merge the omnimind entry into an existing settings object.
 * Preserves unrelated top-level keys and other mcpServers entries.
 */
export function mergeMcpServers(
  existing: ClaudeSettings,
  entry: McpServerEntry,
): ClaudeSettings {
  const next: ClaudeSettings = { ...existing };
  next.mcpServers = { ...(existing.mcpServers ?? {}), omnimind: entry };
  return next;
}

/**
 * Resolve the target settings.json path. Defaults to
 * ~/.claude/settings.json; overridable via OMNIMIND_CLAUDE_SETTINGS_PATH
 * (used by tests and power users with non-standard layouts).
 */
export function settingsPath(): string {
  return (
    process.env.OMNIMIND_CLAUDE_SETTINGS_PATH ??
    join(homedir(), '.claude', 'settings.json')
  );
}

/**
 * Top-level setup function. Reads existing settings (if any), merges
 * the omnimind entry, writes atomically. Honors OMNIMIND_DRY_RUN.
 */
export function runSetup(opts: { stdout?: NodeJS.WritableStream } = {}): {
  path: string;
  dryRun: boolean;
} {
  const out = opts.stdout ?? process.stdout;
  const path = settingsPath();
  const dryRun = process.env.OMNIMIND_DRY_RUN === '1';

  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const parsed = parseSettings(existing);
  const merged = mergeMcpServers(parsed, buildEntry());
  const serialized = JSON.stringify(merged, null, 2) + '\n';

  if (dryRun) {
    out.write(`Would write to ${path}:\n${serialized}\n`);
    return { path, dryRun: true };
  }

  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.omnimind.tmp`;
  writeFileSync(tmpPath, serialized, { mode: 0o600 });
  renameSync(tmpPath, path);
  chmodSync(path, 0o600);
  out.write(`Wrote Omnimind MCP server entry to ${path}\n`);
  return { path, dryRun: false };
}

function main(): void {
  runSetup();
}

// Run when invoked directly; skipped when imported by tests.
if (
  typeof import.meta.url === 'string' &&
  import.meta.url === `file://${process.argv[1]}`
) {
  main();
}