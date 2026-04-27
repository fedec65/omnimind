/**
 * MemoryStore turn-level storage tests
 *
 * Tests the storeTurns batch method for conversation decomposition.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from '../../src/core/MemoryStore.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, rmSync } from 'fs';

describe('MemoryStore.storeTurns', () => {
  let store: MemoryStore;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omnimind-turns-test-'));
    store = new MemoryStore({ dbPath: join(tmpDir, 'test.db') });
    const result = await store.init();
    expect(result.ok).toBe(true);
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should store multiple turns with shared sourceId', async () => {
    const turns = [
      'user: What is the weather?',
      'assistant: It is sunny today.',
      'user: Will it rain tomorrow?',
    ];

    const result = await store.storeTurns(turns, {
      wing: 'chat',
      sourceId: 'session-123',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.length).toBe(3);
    expect(result.value[0]!.sourceId).toBe('session-123');
    expect(result.value[1]!.sourceId).toBe('session-123');
    expect(result.value[2]!.sourceId).toBe('session-123');
  });

  it('should create distinct IDs for each turn', async () => {
    const turns = ['user: Hello', 'assistant: Hi there'];

    const result = await store.storeTurns(turns, { wing: 'chat' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value[0]!.id).not.toBe(result.value[1]!.id);
  });

  it('should be searchable after storing turns', async () => {
    const turns = [
      'user: Tell me about GraphQL',
      'assistant: GraphQL is a query language for APIs.',
      'user: How does it compare to REST?',
    ];

    await store.storeTurns(turns, { wing: 'tech', sourceId: 's1' });

    const search = await store.search('GraphQL API');
    expect(search.ok).toBe(true);
    if (!search.ok) return;

    expect(search.value.length).toBeGreaterThan(0);
    // At least one result should come from the stored turns
    const fromStored = search.value.some(r => r.memory.sourceId === 's1');
    expect(fromStored).toBe(true);
  });

  it('should return empty array for empty turns', async () => {
    const result = await store.storeTurns([], { wing: 'chat' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBe(0);
  });

  it('should count turns in stats', async () => {
    await store.storeTurns(['a', 'b', 'c'], { wing: 'test' });
    await store.store('single', { wing: 'test' });

    const stats = await store.getStats();
    expect(stats.ok).toBe(true);
    if (!stats.ok) return;

    expect(stats.value.totalMemories).toBe(4);
  });
});
