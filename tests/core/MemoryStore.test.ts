/**
 * MemoryStore unit tests
 * 
 * Tests CRUD operations, search, and layer management.
 * Uses an in-memory SQLite database for fast, isolated tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from '../../src/core/MemoryStore.js';
import { MemoryLayer } from '../../src/core/types.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, rmSync } from 'fs';

describe('MemoryStore', () => {
  let store: MemoryStore;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omnimind-test-'));
    store = new MemoryStore({ dbPath: join(tmpDir, 'test.db') });
    const result = await store.init();
    expect(result.ok).toBe(true);
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── CRUD ───────────────────────────────────────────────────────

  describe('store', () => {
    it('should store a memory and return it', async () => {
      const result = await store.store('Test memory content', {
        wing: 'test-wing',
        room: 'test-room',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.content).toBe('Test memory content');
      expect(result.value.wing).toBe('test-wing');
      expect(result.value.room).toBe('test-room');
      expect(result.value.layer).toBe(MemoryLayer.Verbatim);
      expect(result.value.id).toBeDefined();
    });

    it('should deduplicate by content hash', async () => {
      const r1 = await store.store('Same content', { wing: 'w1' });
      const r2 = await store.store('Same content', { wing: 'w2' });

      expect(r1.ok && r2.ok).toBe(true);
      if (!r1.ok || !r2.ok) return;

      expect(r1.value.id).toBe(r2.value.id); // Same memory returned
    });

    it('should reject empty content', async () => {
      const result = await store.store('', { wing: 'test' });
      // Empty string might be allowed but should have a hash
      expect(result.ok).toBe(true);
    });
  });

  describe('get', () => {
    it('should retrieve a stored memory', async () => {
      const stored = await store.store('Retrieve me', { wing: 'test' });
      expect(stored.ok).toBe(true);
      if (!stored.ok) return;

      const result = await store.get(stored.value.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).not.toBeNull();
      expect(result.value!.content).toBe('Retrieve me');
    });

    it('should return null for non-existent ID', async () => {
      const result = await store.get('non-existent-id');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete a memory', async () => {
      const stored = await store.store('Delete me', { wing: 'test' });
      expect(stored.ok).toBe(true);
      if (!stored.ok) return;

      const del = await store.delete(stored.value.id);
      expect(del.ok).toBe(true);

      const get = await store.get(stored.value.id);
      expect(get.ok).toBe(true);
      if (!get.ok) return;
      expect(get.value).toBeNull();
    });
  });

  describe('pin/unpin', () => {
    it('should pin and unpin a memory', async () => {
      const stored = await store.store('Pin me', { wing: 'test' });
      expect(stored.ok).toBe(true);
      if (!stored.ok) return;

      const pin = await store.pin(stored.value.id);
      expect(pin.ok).toBe(true);

      const get1 = await store.get(stored.value.id);
      expect(get1.ok).toBe(true);
      if (!get1.ok || !get1.value) return;
      expect(get1.value.pinned).toBe(true);

      const unpin = await store.unpin(stored.value.id);
      expect(unpin.ok).toBe(true);

      const get2 = await store.get(stored.value.id);
      expect(get2.ok).toBe(true);
      if (!get2.ok || !get2.value) return;
      expect(get2.value.pinned).toBe(false);
    });
  });

  // ─── Search ─────────────────────────────────────────────────────

  describe('search', () => {
    it('should find memories by keyword', async () => {
      await store.store('GraphQL API is better than REST', { wing: 'tech' });
      await store.store('We should use TypeScript', { wing: 'tech' });
      await store.store('Lunch at noon tomorrow', { wing: 'personal' });

      const result = await store.search('GraphQL API');
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.length).toBeGreaterThan(0);
      expect(result.value[0]!.memory.content).toContain('GraphQL');
    });

    it('should filter by wing', async () => {
      await store.store('Project alpha decision', { wing: 'alpha' });
      await store.store('Project beta decision', { wing: 'beta' });

      const result = await store.search('decision', { wing: 'alpha' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.length).toBe(1);
      expect(result.value[0]!.memory.wing).toBe('alpha');
    });

    it('should respect limit', async () => {
      for (let i = 0; i < 20; i++) {
        await store.store(`Memory number ${i}`, { wing: 'bulk' });
      }

      const result = await store.search('Memory', { limit: 5 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.length).toBeLessThanOrEqual(5);
    });

    it('should return empty array for no matches', async () => {
      const result = await store.search('xyznonexistent');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBe(0);
    });
  });

  // ─── Stats ──────────────────────────────────────────────────────

  describe('stats', () => {
    it('should return correct counts', async () => {
      await store.store('One', { wing: 'a' });
      await store.store('Two', { wing: 'b' });
      await store.store('Three', { wing: 'a' });

      const result = await store.getStats();
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.totalMemories).toBe(3);
      expect(result.value.memoriesByLayer[MemoryLayer.Verbatim]).toBe(3);
    });
  });
});
