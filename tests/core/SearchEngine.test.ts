/**
 * SearchEngine unit tests
 *
 * Tests vector search, keyword search, hybrid fusion, and temporal boosting.
 * Uses an in-memory SQLite database with mocked embeddings.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SearchEngine } from '../../src/core/SearchEngine.js';
import { MemoryLayer } from '../../src/core/types.js';
import type { Memory } from '../../src/core/types.js';
import Database from 'better-sqlite3';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, rmSync } from 'fs';

function createMockEmbedding(dim: number, seed: number): Float32Array {
  const arr = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    arr[i] = Math.sin(seed + i * 0.5) + 1; // deterministic pseudo-random
  }
  // Normalize
  let sum = 0;
  for (let i = 0; i < dim; i++) {
    sum += arr[i] * arr[i];
  }
  const norm = Math.sqrt(sum);
  for (let i = 0; i < dim; i++) {
    arr[i] /= norm;
  }
  return arr;
}

function insertMemory(
  db: Database.Database,
  memory: Omit<Memory, 'embedding'> & { embedding: Float32Array },
): void {
  db.prepare(
    `INSERT INTO memories (id, content, content_hash, embedding, layer, wing, room, source_tool, source_id,
     confidence, created_at, accessed_at, access_count, valid_from, valid_to, pinned, compressed_ref, concept_refs)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    memory.id,
    memory.content,
    memory.contentHash,
    Buffer.from(memory.embedding.buffer),
    memory.layer,
    memory.wing,
    memory.room,
    memory.sourceTool,
    memory.sourceId,
    memory.confidence,
    memory.createdAt,
    memory.accessedAt,
    memory.accessCount,
    memory.validFrom,
    memory.validTo,
    memory.pinned ? 1 : 0,
    memory.compressedRef,
    JSON.stringify(memory.conceptRefs),
  );
  // Sync FTS5
  db.prepare("INSERT INTO memories_fts(rowid, content) VALUES ((SELECT rowid FROM memories WHERE id = ?), ?)").run(
    memory.id,
    memory.content,
  );
}

describe('SearchEngine', () => {
  let db: Database.Database;
  let engine: SearchEngine;
  let tmpDir: string;

  const mockEmbeddingEngine = {
    embed: async (text: string) => ({ ok: true, value: createMockEmbedding(384, text.length) }),
  } as unknown as import('../../src/core/EmbeddingEngine.js').EmbeddingEngine;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omnimind-search-test-'));
    db = new Database(join(tmpDir, 'test.db'));

    db.exec(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL UNIQUE,
        embedding BLOB,
        layer INTEGER NOT NULL DEFAULT 0,
        wing TEXT NOT NULL DEFAULT 'general',
        room TEXT NOT NULL DEFAULT 'default',
        source_tool TEXT NOT NULL DEFAULT 'unknown',
        source_id TEXT,
        confidence REAL NOT NULL DEFAULT 1.0,
        created_at INTEGER NOT NULL,
        accessed_at INTEGER,
        access_count INTEGER NOT NULL DEFAULT 0,
        valid_from INTEGER,
        valid_to INTEGER,
        pinned INTEGER NOT NULL DEFAULT 0,
        compressed_ref TEXT,
        concept_refs TEXT
      );
      CREATE VIRTUAL TABLE memories_fts USING fts5(content, content='memories', content_rowid='rowid', tokenize='porter');
    `);

    engine = new SearchEngine(db, mockEmbeddingEngine, { useVss: false });
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('fallback vector search', () => {
    it('should find memories by vector similarity', async () => {
      const embedA = createMockEmbedding(384, 1);
      const embedB = createMockEmbedding(384, 100);

      insertMemory(db, {
        id: 'm1', content: 'GraphQL API', contentHash: 'h1', embedding: embedA,
        layer: MemoryLayer.Verbatim, wing: 'tech', room: 'api', sourceTool: 'test', sourceId: null,
        confidence: 1, createdAt: Date.now(), accessedAt: Date.now(), accessCount: 1,
        validFrom: null, validTo: null, pinned: false, compressedRef: null, conceptRefs: [],
      });
      insertMemory(db, {
        id: 'm2', content: 'REST architecture', contentHash: 'h2', embedding: embedB,
        layer: MemoryLayer.Verbatim, wing: 'tech', room: 'arch', sourceTool: 'test', sourceId: null,
        confidence: 1, createdAt: Date.now(), accessedAt: Date.now(), accessCount: 1,
        validFrom: null, validTo: null, pinned: false, compressedRef: null, conceptRefs: [],
      });

      const results = await engine.vectorSearch(embedA, 10);
      expect(results.length).toBe(2);
      expect(results[0]!.memory.id).toBe('m1');
      expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
    });

    it('should return empty when no memories exist', async () => {
      const results = await engine.vectorSearch(createMockEmbedding(384, 1), 10);
      expect(results.length).toBe(0);
    });
  });

  describe('keyword search', () => {
    it('should find memories by keyword', async () => {
      insertMemory(db, {
        id: 'm1', content: 'GraphQL API design patterns', contentHash: 'h1', embedding: createMockEmbedding(384, 1),
        layer: MemoryLayer.Verbatim, wing: 'tech', room: 'api', sourceTool: 'test', sourceId: null,
        confidence: 1, createdAt: Date.now(), accessedAt: Date.now(), accessCount: 1,
        validFrom: null, validTo: null, pinned: false, compressedRef: null, conceptRefs: [],
      });
      insertMemory(db, {
        id: 'm2', content: 'REST best practices', contentHash: 'h2', embedding: createMockEmbedding(384, 2),
        layer: MemoryLayer.Verbatim, wing: 'tech', room: 'rest', sourceTool: 'test', sourceId: null,
        confidence: 1, createdAt: Date.now(), accessedAt: Date.now(), accessCount: 1,
        validFrom: null, validTo: null, pinned: false, compressedRef: null, conceptRefs: [],
      });

      const results = await engine.keywordSearch('GraphQL', 10);
      expect(results.length).toBe(1);
      expect(results[0]!.memory.id).toBe('m1');
    });

    it('should return empty for no matches', async () => {
      insertMemory(db, {
        id: 'm1', content: 'GraphQL', contentHash: 'h1', embedding: createMockEmbedding(384, 1),
        layer: MemoryLayer.Verbatim, wing: 'tech', room: 'api', sourceTool: 'test', sourceId: null,
        confidence: 1, createdAt: Date.now(), accessedAt: Date.now(), accessCount: 1,
        validFrom: null, validTo: null, pinned: false, compressedRef: null, conceptRefs: [],
      });

      const results = await engine.keywordSearch('xyznonexistent', 10);
      expect(results.length).toBe(0);
    });
  });

  describe('indexVector', () => {
    it('should be a no-op when vss is unavailable', async () => {
      await expect(engine.indexVector('m1', createMockEmbedding(384, 1))).resolves.toBeUndefined();
    });
  });
});
