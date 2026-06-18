/**
 * MCP prompt handler tests.
 *
 * Exercises both prompts (memory-aware, compact-context). Calls the
 * public handleGetPrompt method directly to bypass the MCP SDK transport.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { OmnimindMcpServer } from '../../src/mcp/server.js';
import { MemoryStore } from '../../src/core/MemoryStore.js';

describe('MCP server — prompts', () => {
  let tmpDir: string;
  let store: MemoryStore;
  let server: OmnimindMcpServer;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omnimind-mcp-prompt-'));
    store = new MemoryStore({ dbPath: join(tmpDir, 'test.db') });
    await store.init();

    server = new OmnimindMcpServer();
    (server as any).store = store;
    (server as any).clientNamespace = 'ag-testclient';
  });

  afterEach(async () => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('memory-aware returns a system message with the Omnimind preamble', async () => {
    const result = await (server as any).handleGetPrompt('memory-aware', {});
    expect(result.description).toBe('Memory-aware system prompt');
    expect(Array.isArray(result.messages)).toBe(true);
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content.text).toContain("user's Omnimind memory system");
  });

  it('memory-aware works with custom fingerprint args', async () => {
    const result = await (server as any).handleGetPrompt('memory-aware', {
      projectPath: '/tmp/test',
      gitBranch: 'feature/x',
      currentFile: 'foo.ts',
    });
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content.text).toContain("user's Omnimind memory system");
  });

  it('compact-context with empty history returns a system+user message pair', async () => {
    const result = await (server as any).handleGetPrompt('compact-context', { history: '' });
    expect(result.description).toBe('Memory-aware compacted context');
    expect(result.messages.length).toBe(2);
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[1].role).toBe('user');
    expect(result.messages[1].content.text).toContain('Compressed 0 -> 0 tokens');
  });

  it('compact-context preserves prediction blocks when over budget', async () => {
    const block = '<omnimind_predictions confidence="0.9">\n[wing] important\n</omnimind_predictions>';
    const filler = 'lots of filler '.repeat(200);
    const history = filler + block;
    const result = await (server as any).handleGetPrompt('compact-context', {
      history,
      tokenBudget: '50',
    });
    expect(result.messages[1].content.text).toContain(block);
  });

  it('compact-context defaults tokenBudget to 150 when missing', async () => {
    const result = await (server as any).handleGetPrompt('compact-context', {
      history: 'short history',
    });
    expect(result.messages.length).toBe(2);
    expect(result.messages[1].content.text).toContain('Compressed 2 -> 2 tokens');
  });

  it('unknown prompt name throws', async () => {
    await expect(
      (server as any).handleGetPrompt('no-such-prompt', {}),
    ).rejects.toThrow('Unknown prompt');
  });
});