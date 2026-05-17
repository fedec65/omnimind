import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ClaudeDesktopAdapter } from '../../../src/bus/adapters/ClaudeDesktopAdapter.js';
import { MemoryBus } from '../../../src/bus/MemoryBus.js';
import { MemoryStore } from '../../../src/core/MemoryStore.js';
import { EventType } from '../../../src/bus/types.js';

describe('ClaudeDesktopAdapter', () => {
  let tmpDir: string;
  let store: MemoryStore;
  let bus: MemoryBus;
  let adapter: ClaudeDesktopAdapter;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omnimind-claude-desktop-test-'));
    store = new MemoryStore({ dbPath: join(tmpDir, 'test.db') });
    await store.init();
    bus = new MemoryBus(store);
    adapter = new ClaudeDesktopAdapter(bus, { sessionsPath: join(tmpDir, 'sessions') });
  });

  afterEach(() => {
    adapter.dispose();
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should connect and watch session files', async () => {
    const sessionsDir = join(tmpDir, 'sessions');
    mkdirSync(sessionsDir, { recursive: true });

    await adapter.onConnect();
    expect(adapter['connected']).toBe(true);
  });

  it('should parse and import session metadata', async () => {
    const sessionsDir = join(tmpDir, 'sessions', 'default', 'workspace');
    mkdirSync(sessionsDir, { recursive: true });

    await adapter.onConnect();

    const session = {
      sessionId: 'sess-123',
      cliSessionId: 'cli-456',
      cwd: '/Users/test/project-alpha',
      originCwd: '/Users/test',
      worktreePath: '/Users/test/project-alpha',
      worktreeName: 'project-alpha',
      createdAt: 1700000000000,
      lastActivityAt: 1700003600000,
      model: 'claude-sonnet-4-20250514',
      isArchived: false,
      title: 'Implementing auth system',
    };

    writeFileSync(join(sessionsDir, 'local_sess-123.json'), JSON.stringify(session));

    await new Promise((r) => setTimeout(r, 3000));

    const result = await store.search('auth system', { limit: 10, wing: 'project-alpha' });
    expect(result.ok).toBe(true);
    expect(result.value.length).toBeGreaterThan(0);
    expect(result.value.some((r) => r.memory.content.includes('Implementing auth system'))).toBe(true);
    expect(result.value.some((r) => r.memory.content.includes('/Users/test/project-alpha'))).toBe(true);
  });

  it('should deduplicate unchanged session files', async () => {
    const sessionsDir = join(tmpDir, 'sessions', 'dedup');
    mkdirSync(sessionsDir, { recursive: true });

    await adapter.onConnect();

    const session = {
      sessionId: 'sess-dedup',
      cwd: '/Users/test/dedup',
      createdAt: 1700000000000,
      lastActivityAt: 1700000000000,
      title: 'Dedup test',
    };

    const filePath = join(sessionsDir, 'local_sess-dedup.json');
    writeFileSync(filePath, JSON.stringify(session));

    await new Promise((r) => setTimeout(r, 3000));

    writeFileSync(filePath, JSON.stringify(session));
    await new Promise((r) => setTimeout(r, 3000));

    const all = await store.search('', { limit: 100, wing: 'dedup' });
    expect(all.ok).toBe(true);
    expect(all.value.length).toBe(1);
  });

  it('should skip empty or malformed session files', async () => {
    const sessionsDir = join(tmpDir, 'sessions', 'empty');
    mkdirSync(sessionsDir, { recursive: true });

    await adapter.onConnect();

    writeFileSync(join(sessionsDir, 'local_empty.json'), JSON.stringify({}));
    writeFileSync(join(sessionsDir, 'local_malformed.json'), 'not json at all');

    await new Promise((r) => setTimeout(r, 3000));

    const all = await store.search('', { limit: 100, wing: 'empty' });
    expect(all.ok).toBe(true);
    expect(all.value.length).toBe(0);
  });

  it('should format session without title', async () => {
    const sessionsDir = join(tmpDir, 'sessions', 'notitle');
    mkdirSync(sessionsDir, { recursive: true });

    await adapter.onConnect();

    const session = {
      sessionId: 'sess-notitle',
      cwd: '/Users/test/notitle',
      createdAt: 1700000000000,
      lastActivityAt: 1700000000000,
    };

    writeFileSync(join(sessionsDir, 'local_sess-notitle.json'), JSON.stringify(session));

    await new Promise((r) => setTimeout(r, 3000));

    const result = await store.search('sess-notitle', { limit: 10, wing: 'notitle' });
    expect(result.ok).toBe(true);
    expect(result.value.length).toBeGreaterThan(0);
    expect(result.value[0]!.memory.content).toContain('Claude Desktop session: sess-notitle');
  });

  it('should handle onMemoryEvent without throwing', async () => {
    const event = {
      id: 'ext-1',
      timestamp: Date.now(),
      sourceTool: 'cursor',
      eventType: EventType.Create,
      memoryId: null,
      payload: { content: 'Cursor update', wing: 'ui' },
      vectorClock: {},
      priority: 'auto' as const,
    };

    await expect(adapter.onMemoryEvent(event)).resolves.not.toThrow();
  });

  it('should infer wing from worktreeName', async () => {
    const sessionsDir = join(tmpDir, 'sessions', 'profile', 'workspace');
    mkdirSync(sessionsDir, { recursive: true });

    await adapter.onConnect();

    const session = {
      sessionId: 'sess-wt',
      cwd: '/Users/test/some-deep/path',
      worktreeName: 'my-project',
      createdAt: 1700000000000,
      lastActivityAt: 1700000000000,
      title: 'Deep path session',
    };

    writeFileSync(join(sessionsDir, 'local_sess-wt.json'), JSON.stringify(session));

    await new Promise((r) => setTimeout(r, 3000));

    const result = await store.search('Deep path', { limit: 10, wing: 'my-project' });
    expect(result.ok).toBe(true);
    expect(result.value.length).toBeGreaterThan(0);
  });

  it('should disconnect cleanly', async () => {
    await adapter.onConnect();
    expect(adapter['connected']).toBe(true);

    await adapter.onDisconnect();
    expect(adapter['connected']).toBe(false);
  });
});
