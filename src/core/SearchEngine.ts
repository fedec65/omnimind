/**
 * SearchEngine — Hybrid search combining vector similarity + keyword search
 * 
 * Uses sqlite-vss for vector search and FTS5 for keyword search.
 * Falls back to brute-force cosine similarity if vss is unavailable.
 * 
 * All operations are local — zero external dependencies.
 */

import type Database from 'better-sqlite3';
import { type Memory, type SearchResult } from './types.js';
import type { EmbeddingEngine } from './EmbeddingEngine.js';

export interface SearchEngineConfig {
  useVss?: boolean;  // Use sqlite-vss (if available)
}

/**
 * Hybrid search engine for memory retrieval.
 * 
 * Usage:
 * ```typescript
 * const search = new SearchEngine(db, embeddingEngine);
 * 
 * // Vector search
 * const vResults = await search.vectorSearch(embedding, 10);
 * 
 * // Keyword search
 * const kResults = await search.keywordSearch("GraphQL API", 10);
 * 
 * // Combined fusion done in MemoryStore
 * ```
 */
export class SearchEngine {
  private readonly db: Database.Database;
  private readonly useVss: boolean;
  private vssAvailable = false;

  constructor(db: Database.Database, _embedding: EmbeddingEngine, config: SearchEngineConfig = {}) {
    this.db = db;
    this.useVss = config.useVss ?? true;

    // Check if VSS is available
    try {
      this.db.prepare("SELECT vss_version()").get();
      this.vssAvailable = true;
    } catch {
      this.vssAvailable = false;
      console.warn('[SearchEngine] sqlite-vss not available — using fallback search');
    }
  }

  /**
   * Semantic vector search using cosine similarity.
   * Returns memories ordered by embedding similarity.
   */
  async vectorSearch(
    queryEmbedding: Float32Array,
    limit: number,
    whereClause: string = '',
    params: unknown[] = [],
  ): Promise<SearchResult[]> {
    if (this.vssAvailable && this.useVss) {
      return this.vssSearch(queryEmbedding, limit, whereClause, params);
    }
    return this.fallbackVectorSearch(queryEmbedding, limit, whereClause, params);
  }

  /**
   * Keyword search using FTS5.
   * Returns memories ordered by text relevance.
   */
  async keywordSearch(
    query: string,
    limit: number,
    whereClause: string = '',
    params: unknown[] = [],
  ): Promise<SearchResult[]> {
    try {
      // Clean query for FTS5 (remove special characters)
      const cleanQuery = query
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 1)
        .map(t => `${t}*`)
        .join(' ');

      if (!cleanQuery.trim()) return [];

      const sql = `
        SELECT m.*, rank as fts_score
        FROM memories m
        JOIN memories_fts fts ON m.rowid = fts.rowid
        ${whereClause}
        ${whereClause ? 'AND' : 'WHERE'} memories_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `;

      const rows = this.db.prepare(sql).all(...params, cleanQuery, limit) as Array<
        RawMemoryRow & { fts_score: number }
      >;

      return rows.map(row => ({
        memory: this.rowToMemory(row),
        score: Math.abs(row.fts_score), // FTS5 rank is negative (lower = better)
        matchType: 'keyword' as const,
      }));
    } catch {
      // FTS might not be set up — return empty
      return [];
    }
  }

  /** Insert a vector into the VSS index */
  async indexVector(memoryId: string, embedding: Float32Array): Promise<void> {
    if (!this.vssAvailable) return;

    try {
      // Convert Float32Array to buffer for storage
      const buffer = Buffer.from(embedding.buffer);
      this.db.prepare(
        'INSERT INTO vss_memories(rowid, embedding) VALUES ((SELECT rowid FROM memories WHERE id = ?), ?)',
      ).run(memoryId, buffer);
    } catch {
      // VSS insert failed — non-critical
    }
  }

  // ─── Private: VSS search ─────────────────────────────────────────

  private async vssSearch(
    queryEmbedding: Float32Array,
    limit: number,
    whereClause: string,
    params: unknown[],
  ): Promise<SearchResult[]> {
    try {
      const sql = `
        SELECT m.*, vss.distance
        FROM memories m
        JOIN vss_memories vss ON m.rowid = vss.rowid
        ${whereClause}
        WHERE vss_search(embedding, ?)
        ORDER BY vss.distance
        LIMIT ?
      `;

      const buffer = Buffer.from(queryEmbedding.buffer);
      const rows = this.db.prepare(sql).all(...params, buffer, limit) as Array<
        RawMemoryRow & { distance: number }
      >;

      return rows.map(row => ({
        memory: this.rowToMemory(row),
        score: 1 / (1 + row.distance), // Convert distance to similarity
        matchType: 'vector' as const,
      }));
    } catch {
      // VSS query failed — fall back
      return this.fallbackVectorSearch(queryEmbedding, limit, whereClause, params);
    }
  }

  // ─── Private: Fallback brute-force search ────────────────────────

  private async fallbackVectorSearch(
    queryEmbedding: Float32Array,
    limit: number,
    whereClause: string,
    params: unknown[],
  ): Promise<SearchResult[]> {
    // Get candidate memories (filter first)
    const sql = `SELECT * FROM memories ${whereClause} LIMIT 1000`;
    const rows = this.db.prepare(sql).all(...params) as RawMemoryRow[];

    if (rows.length === 0) return [];

    // Compute cosine similarity for each
    const scored = rows.map(row => {
      // Get embedding from memory (stored as BLOB)
      const embedding = this.getEmbeddingForMemory(row.id);
      if (!embedding) return null;

      const similarity = this.cosineSimilarity(queryEmbedding, embedding);
      return {
        memory: this.rowToMemory(row),
        score: similarity,
        matchType: 'vector' as const,
      };
    });

    // Sort and take top-k
    return scored
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private getEmbeddingForMemory(memoryId: string): Float32Array | null {
    try {
      const row = this.db
        .prepare('SELECT embedding FROM memories WHERE id = ?')
        .get(memoryId) as { embedding: Buffer } | undefined;

      if (!row?.embedding) return null;
      return new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4);
    } catch {
      return null;
    }
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i]! * b[i]!;
      normA += a[i]! * a[i]!;
      normB += b[i]! * b[i]!;
    }

    return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
  }

  private rowToMemory(row: RawMemoryRow): Memory {
    return {
      id: row.id,
      content: row.content,
      contentHash: row.content_hash,
      embedding: new Float32Array(0), // Lazy loaded
      layer: row.layer as 0 | 1 | 2 | 3,
      wing: row.wing,
      room: row.room,
      sourceTool: row.source_tool,
      sourceId: row.source_id,
      confidence: row.confidence,
      createdAt: row.created_at,
      accessedAt: row.accessed_at,
      accessCount: row.access_count,
      validFrom: row.valid_from,
      validTo: row.valid_to,
      pinned: row.pinned === 1,
      compressedRef: row.compressed_ref,
      conceptRefs: row.concept_refs ? JSON.parse(row.concept_refs) : [],
    };
  }
}

/** Raw database row shape (duplicated from MemoryStore for independence) */
interface RawMemoryRow {
  id: string;
  content: string;
  content_hash: string;
  layer: number;
  wing: string;
  room: string;
  source_tool: string;
  source_id: string | null;
  confidence: number;
  created_at: number;
  accessed_at: number;
  access_count: number;
  valid_from: number | null;
  valid_to: number | null;
  pinned: number;
  compressed_ref: string | null;
  concept_refs: string | null;
}
