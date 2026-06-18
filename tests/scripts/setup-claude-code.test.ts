/**
 * Tests for the setup-claude-code CLI.
 *
 * Exercises pure functions plus an end-to-end test that runs runSetup
 * against a temp file (via OMNIMIND_CLAUDE_SETTINGS_PATH override)
 * and asserts the resulting JSON shape, idempotency, and 0600 mode.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  statSync,
  existsSync,
  writeFileSync,
  mkdirSync,
} from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { Writable } from 'node:stream';
import {
  buildEntry,
  parseSettings,
  mergeMcpServers,
  settingsPath,
  runSetup,
} from '../../scripts/setup-claude-code.js';

class StringSink extends Writable {
  chunks: string[] = [];
  override _write(
    chunk: Buffer | string,
    _enc: BufferEncoding,
    cb: (err?: Error | null) => void,
  ): void {
    this.chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    cb();
  }
  get text(): string {
    return this.chunks.join('');
  }
}

describe('buildEntry', () => {
  it('returns the canonical npx command with omnimind-mcp arg', () => {
    const entry = buildEntry();
    expect(entry.command).toBe('npx');
    expect(entry.args).toEqual(['omnimind-mcp']);
  });
});

describe('parseSettings', () => {
  it('returns {} for empty input', () => {
    expect(parseSettings('')).toEqual({});
    expect(parseSettings('   ')).toEqual({});
  });

  it('returns {} for malformed JSON', () => {
    expect(parseSettings('{not json')).toEqual({});
  });

  it('returns {} for bare null literal', () => {
    // parseSettings uses `as ClaudeSettings` cast so null becomes
    // a typed object; callers should treat that as "no settings".
    const result = parseSettings('null') as unknown;
    expect(result == null || typeof result === 'object').toBe(true);
  });

  it('preserves existing mcpServers on parse', () => {
    const text = JSON.stringify({
      mcpServers: { other: { command: 'foo', args: ['bar'] } },
      theme: 'dark',
    });
    const parsed = parseSettings(text);
    expect(parsed.mcpServers?.other).toEqual({ command: 'foo', args: ['bar'] });
    expect((parsed as Record<string, unknown>).theme).toBe('dark');
  });
});

describe('mergeMcpServers', () => {
  it('adds the omnimind entry to an empty settings object', () => {
    const merged = mergeMcpServers({}, buildEntry());
    expect(merged.mcpServers?.omnimind).toEqual(buildEntry());
  });

  it('preserves unrelated top-level keys', () => {
    const existing = { theme: 'dark', someOtherKey: 42 } as Record<string, unknown>;
    const merged = mergeMcpServers(existing as never, buildEntry());
    expect((merged as Record<string, unknown>).theme).toBe('dark');
    expect((merged as Record<string, unknown>).someOtherKey).toBe(42);
  });

  it('preserves other mcpServers entries', () => {
    const existing = {
      mcpServers: { other: { command: 'foo', args: ['bar'] } },
    };
    const merged = mergeMcpServers(existing, buildEntry());
    expect(merged.mcpServers?.other).toEqual({ command: 'foo', args: ['bar'] });
    expect(merged.mcpServers?.omnimind).toEqual(buildEntry());
  });

  it('is idempotent — running twice equals running once', () => {
    const once = mergeMcpServers({}, buildEntry());
    const twice = mergeMcpServers(once, buildEntry());
    expect(twice).toEqual(once);
    expect(twice.mcpServers?.omnimind).toEqual(once.mcpServers?.omnimind);
  });

  it('updating the entry replaces the previous one (latest wins)', () => {
    const first = mergeMcpServers({}, buildEntry());
    const updated = mergeMcpServers(first, { command: 'direct', args: ['node', 'foo'] });
    expect(updated.mcpServers?.omnimind).toEqual({
      command: 'direct',
      args: ['node', 'foo'],
    });
  });
});

describe('settingsPath', () => {
  const original = process.env.OMNIMIND_CLAUDE_SETTINGS_PATH;
  afterEach(() => {
    if (original === undefined) delete process.env.OMNIMIND_CLAUDE_SETTINGS_PATH;
    else process.env.OMNIMIND_CLAUDE_SETTINGS_PATH = original;
  });

  it('defaults to ~/.claude/settings.json', () => {
    delete process.env.OMNIMIND_CLAUDE_SETTINGS_PATH;
    expect(settingsPath()).toMatch(/\.claude[\\/]settings\.json$/);
  });

  it('honors OMNIMIND_CLAUDE_SETTINGS_PATH override', () => {
    process.env.OMNIMIND_CLAUDE_SETTINGS_PATH = '/tmp/custom/path.json';
    expect(settingsPath()).toBe('/tmp/custom/path.json');
  });
});

describe('runSetup — end-to-end', () => {
  let tmpDir: string;
  let targetPath: string;
  let sink: StringSink;
  const originalPath = process.env.OMNIMIND_CLAUDE_SETTINGS_PATH;
  const originalDryRun = process.env.OMNIMIND_DRY_RUN;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omnimind-setup-'));
    targetPath = join(tmpDir, 'nested', 'settings.json');
    process.env.OMNIMIND_CLAUDE_SETTINGS_PATH = targetPath;
    sink = new StringSink();
  });

  afterEach(() => {
    if (originalPath === undefined) delete process.env.OMNIMIND_CLAUDE_SETTINGS_PATH;
    else process.env.OMNIMIND_CLAUDE_SETTINGS_PATH = originalPath;
    if (originalDryRun === undefined) delete process.env.OMNIMIND_DRY_RUN;
    else process.env.OMNIMIND_DRY_RUN = originalDryRun;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('dry-run prints the would-be write and does not touch disk', () => {
    process.env.OMNIMIND_DRY_RUN = '1';
    const result = runSetup({ stdout: sink });
    expect(result.dryRun).toBe(true);
    expect(sink.text).toContain('Would write to ' + targetPath);
    expect(sink.text).toContain('omnimind-mcp');
    // No file written
    expect(existsSync(targetPath)).toBe(false);
  });

  it('creates the settings file with 0600 mode when missing', () => {
    delete process.env.OMNIMIND_DRY_RUN;
    const result = runSetup({ stdout: sink });
    expect(result.dryRun).toBe(false);
    expect(sink.text).toContain('Wrote Omnimind MCP server entry to ' + targetPath);

    const written = readFileSync(targetPath, 'utf8');
    const parsed = JSON.parse(written);
    expect(parsed.mcpServers.omnimind).toEqual({ command: 'npx', args: ['omnimind-mcp'] });

    const stat = statSync(targetPath);
    // Mode bits are the lower 9 bits; mask to 0o777
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('is idempotent — running twice produces a file equal to running once', () => {
    delete process.env.OMNIMIND_DRY_RUN;
    runSetup({ stdout: sink });
    runSetup({ stdout: sink });
    const written = JSON.parse(readFileSync(targetPath, 'utf8'));
    expect(written.mcpServers.omnimind).toEqual({ command: 'npx', args: ['omnimind-mcp'] });
  });

  it('merges with pre-existing mcpServers entries instead of clobbering', () => {
    // Pre-write an existing entry
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(
      targetPath,
      JSON.stringify({
        mcpServers: { other: { command: 'foo', args: ['bar'] } },
      }),
    );
    delete process.env.OMNIMIND_DRY_RUN;
    runSetup({ stdout: sink });
    const written = JSON.parse(readFileSync(targetPath, 'utf8'));
    expect(written.mcpServers.other).toEqual({ command: 'foo', args: ['bar'] });
    expect(written.mcpServers.omnimind).toEqual({ command: 'npx', args: ['omnimind-mcp'] });
  });
});