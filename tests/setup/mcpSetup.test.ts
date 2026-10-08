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
import { parse as parseToml } from 'smol-toml';
import {
  buildEntry,
  buildExplicitEntry,
  detectClients,
  getClientsStatus,
  isClientConfigured,
  mergeMcpServers,
  mergeVsCodeServers,
  parseConfig,
  runSetup,
  getClient,
  MCP_CLIENTS,
  type McpClientId,
  type McpServerEntry,
  type VsCodeClientConfig,
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

describe('McpClient interface', () => {
  it('every registered client exposes a supported flag', () => {
    for (const c of MCP_CLIENTS) {
      expect(typeof c.supported).toBe('boolean');
    }
  });

  it('existing four clients are supported by default and carry no notes/trackingUrl', () => {
    for (const id of ['claude-code', 'cursor', 'claude-desktop', 'kimi'] as const) {
      const c = MCP_CLIENTS.find((x) => x.id === id)!;
      expect(c.supported).toBe(true);
      expect(c.notes).toBeUndefined();
      expect(c.trackingUrl).toBeUndefined();
    }
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

describe('mergeVsCodeServers', () => {
  it('adds the omnimind entry under servers with type stdio', () => {
    const merged = mergeVsCodeServers(
      { theme: 'dark', servers: { other: { command: 'x', args: [], type: 'stdio' as const } } },
      buildEntry(),
    );
    expect(merged.theme).toBe('dark');
    expect(merged.servers?.other).toEqual({ command: 'x', args: [], type: 'stdio' });
    expect(merged.servers?.omnimind).toEqual({ ...buildEntry(), type: 'stdio' });
  });

  it('is idempotent — re-running overwrites only the omnimind entry', () => {
    const once = mergeVsCodeServers({}, buildEntry());
    const twice = mergeVsCodeServers(once, buildEntry());
    expect(Object.keys(twice.servers ?? {})).toEqual(['omnimind']);
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

  it('uses a custom entry when provided (explicit node + script)', () => {
    const entry = buildExplicitEntry('/app/Resources/node/bin/node', '/app/Resources/dist/mcp-server.js');
    runSetup({ home, clients: ['cursor'], entry, out });
    const cfg = JSON.parse(readFileSync(join(home, '.cursor', 'mcp.json'), 'utf8'));
    expect(cfg.mcpServers.omnimind).toEqual(entry);
  });
});

describe('buildExplicitEntry', () => {
  it('points at the given node binary and script', () => {
    expect(buildExplicitEntry('/n/node', '/s/mcp-server.js')).toEqual({
      command: '/n/node',
      args: ['/s/mcp-server.js'],
    });
  });
});

describe('isClientConfigured', () => {
  it('is false when the config file does not exist', () => {
    expect(isClientConfigured(getClient('cursor'), home, 'darwin')).toBe(false);
  });

  it('is true once the omnimind entry is present', () => {
    runSetup({ home, clients: ['cursor'], out });
    expect(isClientConfigured(getClient('cursor'), home, 'darwin')).toBe(true);
  });
});

describe('getClientsStatus', () => {
  it('reports detected and configured flags per client', () => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    runSetup({ home, clients: ['kimi'], out });

    const status = getClientsStatus(home, 'darwin');
    const byId = new Map(status.map((s) => [s.id, s]));

    expect(byId.get('claude-code')).toMatchObject({ detected: true, configured: false });
    expect(byId.get('kimi')).toMatchObject({ detected: true, configured: true });
    expect(byId.get('cursor')).toMatchObject({ detected: false, configured: false });
    expect(byId.get('claude-desktop')?.configPath).toContain('Library/Application Support/Claude');
  });
});

describe('unsupported client entries', () => {
  const UNSUPPORTED_IDS = ['deepseek', 'zai', 'grok', 'muse'] as const;

  it('registers deepseek, zai, grok, muse with supported=false', () => {
    for (const id of UNSUPPORTED_IDS) {
      const c = MCP_CLIENTS.find((x) => x.id === id);
      expect(c, `missing entry for ${id}`).toBeDefined();
      expect(c!.supported).toBe(false);
      expect(c!.notes).toMatch(/.+/);
      expect(c!.trackingUrl).toMatch(/^https:\/\/github\.com\/fedec65\/omnimind\/issues/);
    }
  });

  it('throws when an unsupported client is selected explicitly', () => {
    for (const id of UNSUPPORTED_IDS) {
      expect(() => runSetup({ home, clients: [id], out })).toThrow(/not supported yet/);
    }
  });

  it('unsupported entries are excluded from detectClients results', () => {
    mkdirSync(join(home, '.deepseek'), { recursive: true });
    mkdirSync(join(home, '.grok'), { recursive: true });
    const detected = detectClients(home, 'darwin').map((c) => c.id);
    for (const id of UNSUPPORTED_IDS) {
      expect(detected).not.toContain(id);
    }
  });

  it('getClientsStatus still surfaces unsupported entries with detected=false', () => {
    const status = getClientsStatus(home, 'darwin');
    for (const id of UNSUPPORTED_IDS) {
      const row = status.find((s) => s.id === id);
      expect(row, `missing status row for ${id}`).toBeDefined();
      expect(row!.detected).toBe(false);
      expect(row!.configured).toBe(false);
    }
  });
});

describe('claude-code dual-write', () => {
  it('writes both ~/.claude.json and ~/.claude/settings.json', () => {
    const results = runSetup({ home, clients: ['claude-code'], out });
    expect(results).toHaveLength(1);
    const userScope = readFileSync(join(home, '.claude.json'), 'utf8');
    const projectScope = readFileSync(join(home, '.claude', 'settings.json'), 'utf8');
    expect(JSON.parse(userScope).mcpServers.omnimind).toEqual(buildEntry());
    expect(JSON.parse(projectScope).mcpServers.omnimind).toEqual(buildEntry());
  });

  it('is idempotent: running twice writes the same content', () => {
    runSetup({ home, clients: ['claude-code'], out });
    const firstUser = readFileSync(join(home, '.claude.json'), 'utf8');
    const firstProject = readFileSync(join(home, '.claude', 'settings.json'), 'utf8');
    runSetup({ home, clients: ['claude-code'], out });
    const secondUser = readFileSync(join(home, '.claude.json'), 'utf8');
    const secondProject = readFileSync(join(home, '.claude', 'settings.json'), 'utf8');
    expect(firstUser).toBe(secondUser);
    expect(firstProject).toBe(secondProject);
  });

  it('detects Claude Code via ~/.claude.json alone', () => {
    writeFileSync(join(home, '.claude.json'), '{"mcpServers":{}}');
    const detected = detectClients(home, 'darwin').map((c) => c.id);
    expect(detected).toContain('claude-code');
  });

  it('isClientConfigured is true when only ~/.claude.json has the entry', () => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(
      join(home, '.claude.json'),
      JSON.stringify({ mcpServers: { omnimind: buildEntry() } }),
    );
    expect(isClientConfigured(getClient('claude-code'), home, 'darwin')).toBe(true);
  });

  it('both files are written with 0o600 mode', () => {
    runSetup({ home, clients: ['claude-code'], out });
    expect(statSync(join(home, '.claude.json')).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, '.claude', 'settings.json')).mode & 0o777).toBe(0o600);
  });
});

describe('codex registration', () => {
  it('writes a [mcp_servers.omnimind] sub-table to ~/.codex/config.toml', () => {
    const results = runSetup({ home, clients: ['codex'], out });
    expect(results).toHaveLength(1);
    const path = join(home, '.codex', 'config.toml');
    expect(existsSync(path)).toBe(true);
    // Re-read with smol-toml to assert shape
    const parsed = parseToml(readFileSync(path, 'utf8')) as { mcp_servers: Record<string, McpServerEntry> };
    expect(parsed.mcp_servers.omnimind).toEqual(buildEntry());
  });

  it('is idempotent: re-running yields an equivalent mcp_servers block', () => {
    runSetup({ home, clients: ['codex'], out });
    const first = readFileSync(join(home, '.codex', 'config.toml'), 'utf8');
    runSetup({ home, clients: ['codex'], out });
    const second = readFileSync(join(home, '.codex', 'config.toml'), 'utf8');
    expect(first).toBe(second);
  });

  it('preserves an existing Codex config and other mcp_servers entries', () => {
    const codexDir = join(home, '.codex');
    mkdirSync(codexDir, { recursive: true });
    const existing = [
      'model = "gpt-5"',
      '',
      '[mcp_servers.other]',
      'command = "x"',
      'args = ["--flag"]',
      '',
    ].join('\n');
    writeFileSync(join(codexDir, 'config.toml'), existing);

    runSetup({ home, clients: ['codex'], out });
    const parsed = parseToml(readFileSync(join(codexDir, 'config.toml'), 'utf8')) as {
      model: string;
      mcp_servers: Record<string, McpServerEntry>;
    };
    expect(parsed.model).toBe('gpt-5');
    expect(parsed.mcp_servers.other).toEqual({ command: 'x', args: ['--flag'] });
    expect(parsed.mcp_servers.omnimind).toEqual(buildEntry());
  });

  it('writes with 0o600 mode', () => {
    runSetup({ home, clients: ['codex'], out });
    const mode = statSync(join(home, '.codex', 'config.toml')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('throws when an existing config.toml is malformed instead of overwriting it', () => {
    const codexDir = join(home, '.codex');
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(join(codexDir, 'config.toml'), '[mcp_servers\ncommand = "x"');
    expect(() => runSetup({ home, clients: ['codex'], out })).toThrow(/TOML parse failed/);
  });

  it('dry-run prints the merged TOML without writing to disk', () => {
    const codexDir = join(home, '.codex');
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(join(codexDir, 'config.toml'), 'model = "gpt-5"\n');
    runSetup({ home, clients: ['codex'], dryRun: true, out });
    expect(existsSync(join(codexDir, 'config.toml.omnimind.tmp'))).toBe(false);
    expect(output).toContain('[dry-run]');
    expect(output).toContain('model = "gpt-5"');
    expect(output).toContain('[mcp_servers.omnimind]');
  });
});

describe('vscode paths', () => {
  const vscode = MCP_CLIENTS.find((c) => c.id === 'vscode')!;

  it('macOS path is ~/Library/Application Support/Code/User/mcp.json', () => {
    expect(vscode.configPath('/h', 'darwin')).toBe('/h/Library/Application Support/Code/User/mcp.json');
  });

  it('Linux path is ~/.config/Code/User/mcp.json', () => {
    expect(vscode.configPath('/h', 'linux')).toBe('/h/.config/Code/User/mcp.json');
  });

  it('Windows path is %APPDATA%/Code/User/mcp.json', () => {
    expect(vscode.configPath('/h', 'win32')).toBe('/h/AppData/Roaming/Code/User/mcp.json');
  });

  it('detectPaths returns the User directory so fresh installs are detected', () => {
    expect(vscode.detectPaths('/h', 'darwin')).toEqual(['/h/Library/Application Support/Code/User']);
    expect(vscode.detectPaths('/h', 'linux')).toEqual(['/h/.config/Code/User']);
    expect(vscode.detectPaths('/h', 'win32')).toEqual(['/h/AppData/Roaming/Code/User']);
  });

  it('detects VS Code by the User directory even when mcp.json is absent', () => {
    mkdirSync(join(home, '.config', 'Code', 'User'), { recursive: true });
    expect(detectClients(home, 'linux').map((c) => c.id)).toContain('vscode');
  });

  it('writes the entry under servers with type stdio', () => {
    runSetup({ home, clients: ['vscode'], out, platform: 'linux' });
    const path = join(home, '.config', 'Code', 'User', 'mcp.json');
    const cfg = JSON.parse(readFileSync(path, 'utf8')) as VsCodeClientConfig;
    expect(cfg.servers?.omnimind).toEqual({ ...buildEntry(), type: 'stdio' });
    expect(cfg.mcpServers).toBeUndefined();
  });

  it('isClientConfigured reads servers.omnimind for VS Code', () => {
    runSetup({ home, clients: ['vscode'], out, platform: 'linux' });
    expect(isClientConfigured(getClient('vscode'), home, 'linux')).toBe(true);
  });
});

describe('continue registration', () => {
  it('writes the entry to ~/.continue/config.json', () => {
    runSetup({ home, clients: ['continue'], out });
    const path = join(home, '.continue', 'config.json');
    const cfg = JSON.parse(readFileSync(path, 'utf8'));
    expect(cfg.mcpServers.omnimind).toEqual(buildEntry());
  });

  it('is idempotent', () => {
    runSetup({ home, clients: ['continue'], out });
    const first = readFileSync(join(home, '.continue', 'config.json'), 'utf8');
    runSetup({ home, clients: ['continue'], out });
    const second = readFileSync(join(home, '.continue', 'config.json'), 'utf8');
    expect(first).toBe(second);
  });

  it('preserves an existing config and other mcpServers entries', () => {
    const dir = join(home, '.continue');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({ models: [{ provider: 'openai' }], mcpServers: { other: { command: 'x', args: [] } } }),
    );
    runSetup({ home, clients: ['continue'], out });
    const cfg = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
    expect(cfg.models[0].provider).toBe('openai');
    expect(cfg.mcpServers.other).toEqual({ command: 'x', args: [] });
    expect(cfg.mcpServers.omnimind).toEqual(buildEntry());
  });
});

describe('McpClientId union widening', () => {
  it('every registered id is a valid McpClientId', () => {
    for (const c of MCP_CLIENTS) {
      const id: McpClientId = c.id;
      expect(id).toBe(c.id);
    }
  });

  it('unsupported ids are valid McpClientId values (for honest signaling)', () => {
    const ids: McpClientId[] = ['deepseek', 'zai', 'grok', 'muse'];
    for (const id of ids) {
      const c = MCP_CLIENTS.find((x) => x.id === id);
      expect(c).toBeDefined();
    }
  });

  it('getClient returns the right entry for each id', () => {
    for (const id of ['claude-code', 'cursor', 'claude-desktop', 'kimi', 'codex', 'vscode', 'continue', 'deepseek', 'zai', 'grok', 'muse'] as const) {
      const c = getClient(id);
      expect(c.id).toBe(id);
    }
  });
});
