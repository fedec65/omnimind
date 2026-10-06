/**
 * tomlWriter tests — Codex-shaped TOML round-trips.
 *
 * Uses a temp dir per test; never touches the real user's ~/.codex/.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readTomlConfig,
  writeTomlConfig,
  ensureMcpServer,
  removeMcpServer,
  type TomlConfig,
} from '../../src/setup/tomlWriter.js';
import { buildEntry, type McpServerEntry } from '../../src/setup/mcpSetup.js';

let home: string;
const TMP = (name: string) => join(home, name);

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'omnimind-toml-test-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const CODEX_FIXTURE = `# Existing Codex config — must be preserved on write
model = "gpt-5"
approval_mode = "on-failure"

[mcp_servers.existing]
command = "other-tool"
args = ["--flag"]

[mcp_servers.existing.env]
API_KEY = "secret"
`;

describe('readTomlConfig', () => {
  it('parses a Codex-shaped fixture', () => {
    const path = TMP('config.toml');
    writeFileSync(path, CODEX_FIXTURE);
    const result = readTomlConfig(path);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.model).toBe('gpt-5');
    expect(result.value.approval_mode).toBe('on-failure');
    const servers = result.value.mcp_servers as Record<string, McpServerEntry>;
    expect(servers.existing.command).toBe('other-tool');
    expect(servers.existing.env?.API_KEY).toBe('secret');
  });

  it('returns ok({}) for an empty file', () => {
    const path = TMP('config.toml');
    writeFileSync(path, '');
    const result = readTomlConfig(path);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({});
  });

  it('returns err for a non-existent file', () => {
    const result = readTomlConfig(TMP('missing.toml'));
    expect(result.ok).toBe(false);
  });

  it('returns err for malformed TOML', () => {
    const path = TMP('config.toml');
    writeFileSync(path, 'this = "unterminated string');
    const result = readTomlConfig(path);
    expect(result.ok).toBe(false);
  });
});

describe('writeTomlConfig', () => {
  it('serializes a config to disk with 0o600 mode', () => {
    const path = TMP('config.toml');
    const result = writeTomlConfig(path, { model: 'gpt-5' });
    expect(result.ok).toBe(true);
    expect(existsSync(path)).toBe(true);
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('round-trips a Codex-shaped config through read + write', () => {
    const path = TMP('config.toml');
    writeFileSync(path, CODEX_FIXTURE);
    const read = readTomlConfig(path);
    if (!read.ok) throw new Error('precondition');
    const write = writeTomlConfig(path, read.value);
    expect(write.ok).toBe(true);
    const reparsed = readTomlConfig(path);
    if (!reparsed.ok) throw new Error('reparse');
    expect(reparsed.value).toEqual(read.value);
  });

  it('creates parent directories on write', () => {
    const path = TMP('nested/dir/config.toml');
    const result = writeTomlConfig(path, { model: 'gpt-5' });
    expect(result.ok).toBe(true);
    expect(existsSync(path)).toBe(true);
  });

  it('uses tmp+rename so the target is never half-written', () => {
    const path = TMP('config.toml');
    writeFileSync(path, 'model = "before"');
    const write = writeTomlConfig(path, { model: 'after' });
    expect(write.ok).toBe(true);
    // No leftover .tmp file
    expect(existsSync(`${path}.omnimind.tmp`)).toBe(false);
    // Target contains the new value
    expect(readFileSync(path, 'utf8')).toContain('model = "after"');
  });
});

describe('ensureMcpServer', () => {
  it('adds an entry under mcp_servers without disturbing other tables', () => {
    const before: TomlConfig = { model: 'gpt-5', mcp_servers: { existing: { command: 'x', args: [] } } };
    const after = ensureMcpServer(before, 'omnimind', buildEntry());
    expect((after.mcp_servers as Record<string, McpServerEntry>).existing).toEqual({
      command: 'x',
      args: [],
    });
    expect((after.mcp_servers as Record<string, McpServerEntry>).omnimind).toEqual(buildEntry());
    expect(after.model).toBe('gpt-5');
  });

  it('is idempotent — re-running with the same entry yields the same mcp_servers block', () => {
    const once = ensureMcpServer({}, 'omnimind', buildEntry());
    const twice = ensureMcpServer(once, 'omnimind', buildEntry());
    const servers = twice.mcp_servers as Record<string, McpServerEntry>;
    expect(Object.keys(servers)).toEqual(['omnimind']);
    expect(servers.omnimind).toEqual(buildEntry());
  });

  it('full round-trip: write + read + re-write preserves other tables', () => {
    const path = TMP('config.toml');
    writeFileSync(path, CODEX_FIXTURE);
    const read = readTomlConfig(path);
    if (!read.ok) throw new Error('precondition');
    const merged = ensureMcpServer(read.value, 'omnimind', buildEntry());
    const write = writeTomlConfig(path, merged);
    expect(write.ok).toBe(true);
    const final = readTomlConfig(path);
    if (!final.ok) throw new Error('final');
    const servers = final.value.mcp_servers as Record<string, McpServerEntry>;
    expect(servers.existing).toEqual({ command: 'other-tool', args: ['--flag'], env: { API_KEY: 'secret' } });
    expect(servers.omnimind).toEqual(buildEntry());
    expect(final.value.model).toBe('gpt-5');
  });
});

describe('removeMcpServer', () => {
  it('removes the entry when present', () => {
    const before: TomlConfig = {
      mcp_servers: { omnimind: buildEntry(), other: { command: 'x', args: [] } },
    };
    const after = removeMcpServer(before, 'omnimind');
    const servers = after.mcp_servers as Record<string, McpServerEntry>;
    expect(servers.omnimind).toBeUndefined();
    expect(servers.other).toEqual({ command: 'x', args: [] });
  });

  it('is a no-op when the id is absent', () => {
    const before: TomlConfig = { mcp_servers: { other: { command: 'x', args: [] } } };
    const after = removeMcpServer(before, 'omnimind');
    expect(after).toEqual(before);
  });
});
