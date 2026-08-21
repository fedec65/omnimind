/**
 * PatternStore unit tests
 *
 * Tests SQLite persistence for learned prediction patterns.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
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

  describe('pattern context', () => {
    it('should persist and reload the context components', () => {
      store.save({
        contextSignature: 'sig-ctx',
        memoryId: 'mem-ctx',
        frequency: 2,
        lastAccessed: Date.now(),
        avgConfidence: 0.6,
        context: {
          projectHash: 'proj-1',
          branchHash: 'branch-1',
          fileExtension: '.ts',
          recentWings: ['dev', 'docs'],
          recentRooms: ['api'],
          recentTools: ['search'],
          timeBucket: 'morning',
        },
      });

      const loaded = store.load();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.context).toEqual({
        projectHash: 'proj-1',
        branchHash: 'branch-1',
        fileExtension: '.ts',
        recentWings: ['dev', 'docs'],
        recentRooms: ['api'],
        recentTools: ['search'],
        timeBucket: 'morning',
      });
    });

    it('should load patterns without context as undefined', () => {
      store.save({ contextSignature: 'sig-plain', memoryId: 'mem-1', frequency: 1, lastAccessed: 1, avgConfidence: 0.5 });

      const loaded = store.load();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.context).toBeUndefined();
    });

    it('should migrate a legacy database without context columns', () => {
      // Simulate a pre-migration DB: patterns table without the context columns.
      store.close();
      unlinkSync(dbPath);

      const legacy = new Database(dbPath);
      legacy.exec(`
        CREATE TABLE activity_patterns (
          context_signature TEXT NOT NULL,
          memory_id TEXT NOT NULL,
          frequency INTEGER NOT NULL DEFAULT 1,
          last_accessed INTEGER NOT NULL,
          avg_confidence REAL NOT NULL DEFAULT 0.5,
          PRIMARY KEY (context_signature, memory_id)
        );
      `);
      legacy.prepare(
        'INSERT INTO activity_patterns (context_signature, memory_id, frequency, last_accessed, avg_confidence) VALUES (?, ?, ?, ?, ?)',
      ).run('legacy-sig', 'legacy-mem', 5, 12345, 0.8);
      legacy.close();

      const migrated = new PatternStore({ dbPath });
      const loaded = migrated.load();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]).toMatchObject({
        contextSignature: 'legacy-sig',
        memoryId: 'legacy-mem',
        frequency: 5,
      });
      expect(loaded[0]!.context).toBeUndefined();

      // New saves with context must work on the migrated schema.
      migrated.save({
        contextSignature: 'new-sig',
        memoryId: 'new-mem',
        frequency: 1,
        lastAccessed: Date.now(),
        avgConfidence: 0.5,
        context: {
          projectHash: 'p',
          branchHash: 'b',
          fileExtension: '',
          recentWings: ['w'],
          recentRooms: [],
          recentTools: [],
          timeBucket: 'evening',
        },
      });
      const reloaded = migrated.load();
      expect(reloaded).toHaveLength(2);
      migrated.close();

      // Re-open a fresh store for afterEach cleanup symmetry.
      store = new PatternStore({ dbPath });
    });
  });
});
