/**
 * PatternStore unit tests
 *
 * Tests SQLite persistence for learned prediction patterns.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PatternStore } from '../../src/prediction/PatternStore.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';

function tempDb(): string {
  return join(tmpdir(), `omnimind-pattern-test-${Date.now()}.db`);
}

describe('PatternStore', () => {
  let dbPath: string;
  let store: PatternStore;

  beforeEach(() => {
    dbPath = tempDb();
    store = new PatternStore({ dbPath });
  });

  afterEach(() => {
    store.close();
    if (existsSync(dbPath)) {
      unlinkSync(dbPath);
    }
  });

  describe('load and save', () => {
    it('should return empty array when no patterns exist', () => {
      const patterns = store.load();
      expect(patterns).toEqual([]);
    });

    it('should persist and reload a pattern', () => {
      store.save({
        contextSignature: 'sig-1',
        memoryId: 'mem-1',
        frequency: 3,
        lastAccessed: Date.now(),
        avgConfidence: 0.75,
      });

      const loaded = store.load();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]).toMatchObject({
        contextSignature: 'sig-1',
        memoryId: 'mem-1',
        frequency: 3,
        avgConfidence: 0.75,
      });
    });

    it('should update existing pattern on save', () => {
      store.save({
        contextSignature: 'sig-1',
        memoryId: 'mem-1',
        frequency: 1,
        lastAccessed: 1000,
        avgConfidence: 0.5,
      });

      store.save({
        contextSignature: 'sig-1',
        memoryId: 'mem-1',
        frequency: 5,
        lastAccessed: 2000,
        avgConfidence: 0.9,
      });

      const loaded = store.load();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.frequency).toBe(5);
      expect(loaded[0]!.avgConfidence).toBe(0.9);
    });

    it('should save multiple patterns with same signature', () => {
      store.save({ contextSignature: 'sig-a', memoryId: 'mem-1', frequency: 1, lastAccessed: 1, avgConfidence: 0.5 });
      store.save({ contextSignature: 'sig-a', memoryId: 'mem-2', frequency: 2, lastAccessed: 2, avgConfidence: 0.6 });

      const loaded = store.load();
      expect(loaded).toHaveLength(2);
    });
  });

  describe('saveBatch', () => {
    it('should save multiple patterns in a transaction', () => {
      const result = store.saveBatch([
        { contextSignature: 'sig-1', memoryId: 'mem-1', frequency: 1, lastAccessed: 1, avgConfidence: 0.5 },
        { contextSignature: 'sig-2', memoryId: 'mem-2', frequency: 2, lastAccessed: 2, avgConfidence: 0.6 },
        { contextSignature: 'sig-3', memoryId: 'mem-3', frequency: 3, lastAccessed: 3, avgConfidence: 0.7 },
      ]);

      expect(result.ok).toBe(true);
      const loaded = store.load();
      expect(loaded).toHaveLength(3);
    });
  });

  describe('prune', () => {
    it('should remove patterns older than cutoff', () => {
      const now = Date.now();
      store.save({ contextSignature: 'old', memoryId: 'mem-1', frequency: 1, lastAccessed: now - 100000, avgConfidence: 0.5 });
      store.save({ contextSignature: 'new', memoryId: 'mem-2', frequency: 1, lastAccessed: now, avgConfidence: 0.5 });

      const result = store.prune(50000);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(1);
      }

      const loaded = store.load();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.contextSignature).toBe('new');
    });
  });

  describe('getStats', () => {
    it('should return correct stats', () => {
      store.save({ contextSignature: 'sig-a', memoryId: 'mem-1', frequency: 1, lastAccessed: 1, avgConfidence: 0.5 });
      store.save({ contextSignature: 'sig-a', memoryId: 'mem-2', frequency: 1, lastAccessed: 1, avgConfidence: 0.5 });
      store.save({ contextSignature: 'sig-b', memoryId: 'mem-3', frequency: 1, lastAccessed: 1, avgConfidence: 0.5 });

      const stats = store.getStats();
      expect(stats.ok).toBe(true);
      if (stats.ok) {
        expect(stats.value.totalPatterns).toBe(3);
        expect(stats.value.uniqueContexts).toBe(2);
      }
    });
  });
});
