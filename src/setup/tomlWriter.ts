/**
 * tomlWriter — Codex-shaped TOML config read/write.
 *
 * Mirrors the JSON writer in mcpSetup.ts: atomic write via tmp+rename,
 * 0o600 file mode, tolerant of missing input, preserves unknown
 * top-level keys. Used by the Codex CLI MCP client registration path.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
  renameSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { parse, stringify } from 'smol-toml';
import { ok, err, type Result } from '../core/types.js';
import type { McpServerEntry } from './mcpSetup.js';

export interface TomlConfig {
  [key: string]: unknown;
}

const DEFAULT_MODE = 0o600;

export function readTomlConfig(path: string): Result<TomlConfig, Error> {
  if (!existsSync(path)) return err(new Error('TOML read failed: file not found'));
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (cause) {
    return err(new Error(`TOML read failed: ${(cause as Error).message}`));
  }
  try {
    return ok(parse(text) as TomlConfig);
  } catch (cause) {
    return err(new Error(`TOML parse failed: ${(cause as Error).message}`));
  }
}

export function writeTomlConfig(
  path: string,
  config: TomlConfig,
  opts: { mode?: number } = {},
): Result<void, Error> {
  const mode = opts.mode ?? DEFAULT_MODE;
  try {
    mkdirSync(dirname(path), { recursive: true });
    const serialized = stringify(config);
    const tmpPath = `${path}.omnimind.tmp`;
    writeFileSync(tmpPath, serialized, { mode });
    renameSync(tmpPath, path);
    chmodSync(path, mode);
    return ok(undefined);
  } catch (cause) {
    return err(new Error(`TOML write failed: ${(cause as Error).message}`));
  }
}

/**
 * Insert or overwrite the `id` sub-table under `[mcp_servers]`.
 * Idempotent: calling twice with the same arguments leaves the
 * mcp_servers block equivalent.
 */
export function ensureMcpServer(
  config: TomlConfig,
  id: string,
  entry: McpServerEntry,
): TomlConfig {
  const servers: Record<string, McpServerEntry> = {
    ...((config.mcp_servers as Record<string, McpServerEntry> | undefined) ?? {}),
    [id]: entry,
  };
  return { ...config, mcp_servers: servers };
}

/** Remove the `id` sub-table from `[mcp_servers]`. No-op if absent. */
export function removeMcpServer(config: TomlConfig, id: string): TomlConfig {
  const servers = (config.mcp_servers as Record<string, McpServerEntry> | undefined) ?? {};
  if (!(id in servers)) return config;
  const next = { ...servers };
  delete next[id];
  return { ...config, mcp_servers: next };
}
