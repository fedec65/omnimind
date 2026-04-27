import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CursorAdapter } from '../../../src/bus/adapters/CursorAdapter.js';
import { MemoryBus } from '../../../src/bus/MemoryBus.js';
import { MemoryStore } from '../../../src/core/MemoryStore.js';

describe('CursorAdapter', () => {
  let tmpDir: string;
  let store: MemoryStore;
  let bus: MemoryBus;
  let adapter: CursorAdapter;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omnimind-cursor-test-'));
    store = new MemoryStore({ dbPath: join(tmpDir, 'test.db') });
    await store.init();
    bus = new MemoryBus(store);
    adapter = new CursorAdapter(bus, { watchPath: join(tmpDir, 'cursor-conversations') });
  });

  afterEach(() => {
    adapter.dispose();
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should detect and process .jsonl conversation files', async () => {
    const watchDir = join(tmpDir, 'cursor-conversations', 'project-a');
    mkdirSync(watchDir, { recursive: true });

    await adapter.onConnect();

    const conversation = [
      { role: 'user', content: 'How do I refactor this React component?' },
      { role: 'assistant', content: 'You can extract the logic into a custom hook.' },
    ];
    writeFileSync(join(watchDir, 'chat.jsonl'), conversation.map((t) => JSON.stringify(t)).join('\n'));

    await new Promise((r) => setTimeout(r, 3000));

    const result = await store.search('custom hook', { limit: 10, wing: 'project-a' });
    expect(result.ok).toBe(true);
    expect(result.value.length).toBeGreaterThan(0);
    expect(result.value.some((r) => r.memory.content.includes('custom hook'))).toBe(true);
  });

  it('should detect and process .json conversation files', async () => {
    const watchDir = join(tmpDir, 'cursor-conversations', 'project-b');
    mkdirSync(watchDir, { recursive: true });

    await adapter.onConnect();

    const conversation = [
      { role: 'user', content: 'Explain TypeScript generics' },
      { role: 'assistant', content: 'Generics allow you to create reusable components.' },
    ];
    writeFileSync(join(watchDir, 'chat.json'), JSON.stringify(conversation));

    await new Promise((r) => setTimeout(r, 3000));

    const result = await store.search('Generics', { limit: 10, wing: 'project-b' });
    expect(result.ok).toBe(true);
    expect(result.value.length).toBeGreaterThan(0);
  });

  it('should deduplicate unchanged files', async () => {
    const watchDir = join(tmpDir, 'cursor-conversations', 'dedup');
    mkdirSync(watchDir, { recursive: true });

    await adapter.onConnect();

    const filePath = join(watchDir, 'repeat.jsonl');
    const conversation = [{ role: 'user', content: 'Same message' }];
    writeFileSync(filePath, JSON.stringify(conversation[0]));

    await new Promise((r) => setTimeout(r, 3000));

    writeFileSync(filePath, JSON.stringify(conversation[0]));
    await new Promise((r) => setTimeout(r, 3000));

    const all = await store.search('', { limit: 100, wing: 'dedup' });
    expect(all.ok).toBe(true);
    expect(all.value.length).toBe(1);
  });

  it('should skip non-dialogue roles', async () => {
    const watchDir = join(tmpDir, 'cursor-conversations', 'roles');
    mkdirSync(watchDir, { recursive: true });

    await adapter.onConnect();

    const conversation = [
      { role: 'system', content: 'You are a helpful assistant' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
      { role: 'tool', content: 'search results' },
    ];
    writeFileSync(join(watchDir, 'mixed.jsonl'), conversation.map((t) => JSON.stringify(t)).join('\n'));

    await new Promise((r) => setTimeout(r, 3000));

    const all = await store.search('', { limit: 100, wing: 'roles' });
    expect(all.ok).toBe(true);
    // Only user + assistant = 2 turns
    expect(all.value.length).toBe(2);
  });
});
