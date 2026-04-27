import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ChatGPTAdapter } from '../../../src/bus/adapters/ChatGPTAdapter.js';
import { MemoryBus } from '../../../src/bus/MemoryBus.js';
import { MemoryStore } from '../../../src/core/MemoryStore.js';

describe('ChatGPTAdapter', () => {
  let tmpDir: string;
  let store: MemoryStore;
  let bus: MemoryBus;
  let adapter: ChatGPTAdapter;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omnimind-chatgpt-test-'));
    store = new MemoryStore({ dbPath: join(tmpDir, 'test.db') });
    await store.init();
    bus = new MemoryBus(store);
    adapter = new ChatGPTAdapter(bus, { watchPath: join(tmpDir, 'chatgpt-exports') });
  });

  afterEach(() => {
    adapter.dispose();
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should parse and import ChatGPT export format', async () => {
    const watchDir = join(tmpDir, 'chatgpt-exports', 'batch-1');
    mkdirSync(watchDir, { recursive: true });

    await adapter.onConnect();

    const exportData = {
      conversations: [
        {
          title: 'React Patterns',
          create_time: 1700000000.0,
          mapping: {
            'root-1': {
              message: null,
              parent: null,
              children: ['msg-1'],
            },
            'msg-1': {
              message: {
                id: 'msg-1',
                author: { role: 'user' },
                content: { parts: ['What are React hooks?'] },
                create_time: 1700000001.0,
              },
              parent: 'root-1',
              children: ['msg-2'],
            },
            'msg-2': {
              message: {
                id: 'msg-2',
                author: { role: 'assistant' },
                content: { parts: ['Hooks let you use state in functional components.'] },
                create_time: 1700000002.0,
              },
              parent: 'msg-1',
              children: ['msg-3'],
            },
            'msg-3': {
              message: {
                id: 'msg-3',
                author: { role: 'user' },
                content: { parts: ['Can you show me useEffect?'] },
                create_time: 1700000003.0,
              },
              parent: 'msg-2',
              children: [],
            },
          },
        },
      ],
    };

    writeFileSync(join(watchDir, 'conversations.json'), JSON.stringify(exportData));

    await new Promise((r) => setTimeout(r, 3000));

    const result = await store.search('React hooks', { limit: 10, wing: 'batch-1' });
    expect(result.ok).toBe(true);
    expect(result.value.length).toBeGreaterThan(0);
    expect(result.value.some((r) => r.memory.content.includes('React hooks'))).toBe(true);
  });

  it('should deduplicate identical export files', async () => {
    const watchDir = join(tmpDir, 'chatgpt-exports', 'dedup');
    mkdirSync(watchDir, { recursive: true });

    await adapter.onConnect();

    const exportData = {
      conversations: [
        {
          title: 'Single',
          mapping: {
            root: { message: null, parent: null, children: ['m1'] },
            m1: {
              message: { author: { role: 'user' }, content: { parts: ['Hello'] } },
              parent: 'root',
              children: [],
            },
          },
        },
      ],
    };

    const filePath = join(watchDir, 'export.json');
    writeFileSync(filePath, JSON.stringify(exportData));
    await new Promise((r) => setTimeout(r, 3000));

    writeFileSync(filePath, JSON.stringify(exportData));
    await new Promise((r) => setTimeout(r, 3000));

    const all = await store.search('', { limit: 100, wing: 'dedup' });
    expect(all.ok).toBe(true);
    expect(all.value.length).toBe(1);
  });

  it('should skip empty or malformed exports', async () => {
    const watchDir = join(tmpDir, 'chatgpt-exports', 'empty');
    mkdirSync(watchDir, { recursive: true });

    await adapter.onConnect();

    writeFileSync(join(watchDir, 'empty.json'), JSON.stringify({ conversations: [] }));
    writeFileSync(join(watchDir, 'malformed.json'), 'not json at all');

    await new Promise((r) => setTimeout(r, 3000));

    const all = await store.search('', { limit: 100, wing: 'empty' });
    expect(all.ok).toBe(true);
    expect(all.value.length).toBe(0);
  });

  it('should handle multi-part content', async () => {
    const watchDir = join(tmpDir, 'chatgpt-exports', 'multipart');
    mkdirSync(watchDir, { recursive: true });

    await adapter.onConnect();

    const exportData = {
      conversations: [
        {
          title: 'Multi',
          mapping: {
            root: { message: null, parent: null, children: ['m1'] },
            m1: {
              message: {
                author: { role: 'assistant' },
                content: { parts: ['First part.', ' Second part.'] },
              },
              parent: 'root',
              children: [],
            },
          },
        },
      ],
    };

    writeFileSync(join(watchDir, 'multi.json'), JSON.stringify(exportData));
    await new Promise((r) => setTimeout(r, 3000));

    const result = await store.search('First part', { limit: 10, wing: 'multipart' });
    expect(result.ok).toBe(true);
    expect(result.value.length).toBeGreaterThan(0);
    expect(result.value[0]!.memory.content).toContain('First part. Second part.');
  });
});
