/**
 * mcpSetup tests — multi-client MCP registration.
 *
 * Uses a temp home directory per test; never touches the real user config.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Writable } from 'node:stream';
import {
  buildEntry,
  detectClients,
  mergeMcpServers,
  parseConfig,
  runSetup,
  MCP_CLIENTS,
} from '../../src/setup/mcpSetup.js';

let home: string;
let output: string;
let out: Writable;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'omnimind-setup-test-'));
  output = '';
  out = new Writable({
    write(chunk, _enc, cb) {
      output += chunk.toString();
      cb();
    },
  });
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('buildEntry', () => {
  it('uses npx with the omnimind-mcp package', () => {
    expect(buildEntry()).toEqual({ command: 'npx', args: ['-y', 'omnimind-mcp'] });
  });
});

describe('parseConfig', () => {
  it('parses valid JSON', () => {
    expect(parseConfig('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns {} for empty or malformed input', () => {
    expect(parseConfig('')).toEqual({});
    expect(parseConfig('   ')).toEqual({});
    expect(parseConfig('{not json')).toEqual({});
  });
});

describe('mergeMcpServers', () => {
  it('adds the omnimind entry preserving other servers and keys', () => {
    const merged = mergeMcpServers(
      { theme: 'dark', mcpServers: { other: { command: 'x', args: [] } } },
      buildEntry(),
    );
    expect(merged.theme).toBe('dark');
    expect(merged.mcpServers?.other).toEqual({ command: 'x', args: [] });
    expect(merged.mcpServers?.omnimind).toEqual(buildEntry());
  });

  it('is idempotent — re-running overwrites only the omnimind entry', () => {
    const once = mergeMcpServers({}, buildEntry());
    const twice = mergeMcpServers(once, buildEntry());
    expect(Object.keys(twice.mcpServers ?? {})).toEqual(['omnimind']);
  });
});

describe('detectClients', () => {
  it('detects nothing in an empty home', () => {
    expect(detectClients(home, 'darwin')).toEqual([]);
  });

  it('detects clients by config directory', () => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    mkdirSync(join(home, '.kimi-code'), { recursive: true });
    const ids = detectClients(home, 'darwin').map((c) => c.id);
    expect(ids).toEqual(['claude-code', 'kimi']);
  });

  it('detects a client by config file even without a pre-existing dir scan', () => {
    const cfgDir = join(home, '.cursor');
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(join(cfgDir, 'mcp.json'), '{}');
    expect(detectClients(home, 'darwin').map((c) => c.id)).toEqual(['cursor']);
  });

  it('resolves the Claude Desktop path per platform', () => {
    const desktop = MCP_CLIENTS.find((c) => c.id === 'claude-desktop')!;
    expect(desktop.configPath('/h', 'darwin')).toBe('/h/Library/Application Support/Claude/claude_desktop_config.json');
    expect(desktop.configPath('/h', 'win32')).toBe('/h/AppData/Roaming/Claude/claude_desktop_config.json');
    expect(desktop.configPath('/h', 'linux')).toBe('/h/.config/Claude/claude_desktop_config.json');
  });
});

describe('runSetup', () => {
  it('writes the entry into every detected client', () => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    mkdirSync(join(home, '.cursor'), { recursive: true });

    const results = runSetup({ home, out });
    expect(results).toHaveLength(2);

    for (const path of [join(home, '.claude', 'settings.json'), join(home, '.cursor', 'mcp.json')]) {
      const cfg = JSON.parse(readFileSync(path, 'utf8'));
      expect(cfg.mcpServers.omnimind).toEqual(buildEntry());
    }
    expect(output).toContain('Claude Code');
    expect(output).toContain('Cursor');
  });

  it('configures an explicit client even when not detected', () => {
    const results = runSetup({ home, clients: ['kimi'], out });
    expect(results).toHaveLength(1);
    const cfg = JSON.parse(readFileSync(join(home, '.kimi-code', 'mcp.json'), 'utf8'));
    expect(cfg.mcpServers.omnimind).toEqual(buildEntry());
  });

  it('throws when no clients are detected and none specified', () => {
    expect(() => runSetup({ home, out })).toThrow(/No supported MCP clients detected/);
  });

  it('preserves existing config content and other servers', () => {
    const cfgDir = join(home, '.claude');
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, 'settings.json'),
      JSON.stringify({ model: 'opus', mcpServers: { other: { command: 'x', args: [] } } }),
    );

    runSetup({ home, clients: ['claude-code'], out });
    const cfg = JSON.parse(readFileSync(join(cfgDir, 'settings.json'), 'utf8'));
    expect(cfg.model).toBe('opus');
    expect(cfg.mcpServers.other).toEqual({ command: 'x', args: [] });
    expect(cfg.mcpServers.omnimind).toEqual(buildEntry());
  });

  it('dry-run writes nothing to disk', () => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    runSetup({ home, dryRun: true, out });
    expect(existsSync(join(home, '.claude', 'settings.json'))).toBe(false);
    expect(output).toContain('[dry-run]');
    expect(output).toContain('omnimind-mcp');
  });

  it('writes configs with 0o600 permissions', () => {
    runSetup({ home, clients: ['cursor'], out });
    const mode = statSync(join(home, '.cursor', 'mcp.json')).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
