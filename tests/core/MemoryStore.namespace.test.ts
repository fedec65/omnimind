import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryStore } from '../../src/core/MemoryStore.js';

describe('MemoryStore namespace isolation', () => {
  let tmpDir: string;
  let store: MemoryStore;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omnimind-ns-test-'));
    store = new MemoryStore({ dbPath: join(tmpDir, 'test.db') });
    await store.init();
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should store memories in different namespaces', async () => {
    const r1 = await store.store('Hello from Claude', { wing: 'test', namespace: 'claude-code' });
    const r2 = await store.store('Hello from Cursor', { wing: 'test', namespace: 'cursor' });

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r1.value.namespace).toBe('claude-code');
    expect(r2.value.namespace).toBe('cursor');
  });

  it('should scope search by namespace', async () => {
    await store.store('Claude memory', { wing: 'test', namespace: 'claude-code' });
    await store.store('Cursor memory', { wing: 'test', namespace: 'cursor' });

    const claudeResults = await store.search('memory', { namespace: 'claude-code', limit: 10 });
    expect(claudeResults.ok).toBe(true);
    expect(claudeResults.value.length).toBe(1);
    expect(claudeResults.value[0]!.memory.namespace).toBe('claude-code');

    const cursorResults = await store.search('memory', { namespace: 'cursor', limit: 10 });
    expect(cursorResults.ok).toBe(true);
    expect(cursorResults.value.length).toBe(1);
    expect(cursorResults.value[0]!.memory.namespace).toBe('cursor');
  });

  it('should find all namespaces when no namespace filter is set', async () => {
    await store.store('Claude memory', { wing: 'test', namespace: 'claude-code' });
    await store.store('Cursor memory', { wing: 'test', namespace: 'cursor' });

    const allResults = await store.search('memory', { limit: 10 });
    expect(allResults.ok).toBe(true);
    expect(allResults.value.length).toBe(2);
  });

  it('should deduplicate only within the same namespace', async () => {
    const r1 = await store.store('Same content', { wing: 'test', namespace: 'claude-code' });
    const r2 = await store.store('Same content', { wing: 'test', namespace: 'cursor' });

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r1.value.id).not.toBe(r2.value.id);
  });

  it('should default to default namespace when not specified', async () => {
    const r = await store.store('No namespace specified', { wing: 'test' });
    expect(r.ok).toBe(true);
    expect(r.value.namespace).toBe('default');
  });

  it('should scope storeTurns by namespace', async () => {
    const result = await store.storeTurns(
      ['user: Hello', 'assistant: Hi'],
      { wing: 'test', namespace: 'chatgpt' },
    );
    expect(result.ok).toBe(true);
    expect(result.value.length).toBe(2);
    expect(result.value[0]!.namespace).toBe('chatgpt');
    expect(result.value[1]!.namespace).toBe('chatgpt');
  });

  it('should scope search across namespaces in storeTurns', async () => {
    await store.storeTurns(
      ['user: Hello Claude'],
      { wing: 'test', namespace: 'claude-code' },
    );
    await store.storeTurns(
      ['user: Hello Cursor'],
      { wing: 'test', namespace: 'cursor' },
    );

    const claudeSearch = await store.search('Hello', { namespace: 'claude-code', limit: 10 });
    expect(claudeSearch.ok).toBe(true);
    expect(claudeSearch.value.length).toBe(1);

    const cursorSearch = await store.search('Hello', { namespace: 'cursor', limit: 10 });
    expect(cursorSearch.ok).toBe(true);
    expect(cursorSearch.value.length).toBe(1);
  });
});
