/**
 * MemoryStore — Core memory storage engine
 * 
 * Provides CRUD operations, search, and hierarchical layer management.
 * All data stored in SQLite with vector search via sqlite-vss and
 * keyword search via FTS5.
 * 
 * 100% local — zero external API calls.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import {
  type Memory,
  type MemoryMeta,
  type MemoryLayerId,
  type SearchResult,
  type SearchOptions,
  type StoreStats,
  type Result,
  MemoryLayer,
  DefaultSearchConfig,
  ok,
  err,
} from './types.js';
import { EmbeddingEngine } from './EmbeddingEngine.js';
import { SearchEngine } from './SearchEngine.js';
import { CryptoEngine } from './CryptoEngine.js';

/** Database initialization SQL */
const INIT_SQL = `
-- Main memories table
CREATE TABLE IF NOT EXISTS memories (
  id              TEXT PRIMARY KEY,
  content         TEXT NOT NULL,
  content_hash    TEXT NOT NULL UNIQUE,
  embedding       BLOB,                -- 384-dim Float32Array as buffer
  layer           INTEGER NOT NULL DEFAULT 0,
  wing            TEXT NOT NULL DEFAULT 'general',
  room            TEXT NOT NULL DEFAULT 'default',
  source_tool     TEXT NOT NULL DEFAULT 'unknown',
  source_id       TEXT,
  confidence      REAL NOT NULL DEFAULT 1.0,
  created_at      INTEGER NOT NULL,
  accessed_at     INTEGER,
  access_count    INTEGER NOT NULL DEFAULT 0,
  valid_from      INTEGER,
  valid_to        INTEGER,
  pinned          INTEGER NOT NULL DEFAULT 0,
  compressed_ref  TEXT,
  concept_refs    TEXT -- JSON array
);

-- Entity table for knowledge graph
CREATE TABLE IF NOT EXISTS entities (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'unknown',
  description     TEXT,
  first_seen      INTEGER NOT NULL,
  last_seen       INTEGER NOT NULL,
  mention_count   INTEGER NOT NULL DEFAULT 1
);

-- Relations table for knowledge graph
CREATE TABLE IF NOT EXISTS relations (
  id              TEXT PRIMARY KEY,
  subject_id      TEXT NOT NULL REFERENCES entities(id),
  predicate       TEXT NOT NULL,
  object_id       TEXT NOT NULL REFERENCES entities(id),
  valid_from      INTEGER,
  valid_to        INTEGER,
  source_memory   TEXT REFERENCES memories(id) ON DELETE SET NULL,
  confidence      REAL NOT NULL DEFAULT 1.0
);

-- Activity log for predictions
CREATE TABLE IF NOT EXISTS activity_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp       INTEGER NOT NULL,
  activity_type   TEXT NOT NULL,
  context_hash    TEXT,
  memory_id       TEXT REFERENCES memories(id) ON DELETE SET NULL,
  tool_name       TEXT,
  project_path    TEXT,
  git_branch      TEXT
);

-- Predictions tracking
CREATE TABLE IF NOT EXISTS predictions (
  id              TEXT PRIMARY KEY,
  timestamp       INTEGER NOT NULL,
  context_hash    TEXT NOT NULL,
  predicted_memories TEXT NOT NULL, -- JSON
  confidence      REAL NOT NULL,
  was_accepted    INTEGER,
  user_feedback   TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_memories_layer ON memories(layer);
CREATE INDEX IF NOT EXISTS idx_memories_wing ON memories(wing);
CREATE INDEX IF NOT EXISTS idx_memories_room ON memories(room);
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
CREATE INDEX IF NOT EXISTS idx_memories_accessed ON memories(accessed_at);
CREATE INDEX IF NOT EXISTS idx_relations_subject ON relations(subject_id);
CREATE INDEX IF NOT EXISTS idx_relations_object ON relations(object_id);
CREATE INDEX IF NOT EXISTS idx_relations_predicate ON relations(predicate);
CREATE INDEX IF NOT EXISTS idx_activity_time ON activity_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_activity_context ON activity_log(context_hash);
`;

/** VSS extension loading and virtual table setup */
const VSS_SQL = `
-- Load the vss extension (must be available as loadable extension)
SELECT load_extension('vector0');
SELECT load_extension('vss0');

-- Virtual table for vector search (will be populated from memories)
CREATE VIRTUAL TABLE IF NOT EXISTS vss_memories USING vss0(
  embedding(384)  -- all-MiniLM-L6-v2 dimensions
);
`;

/** FTS5 virtual table for keyword search */
const FTS_SQL = `
-- FTS5 for full-text keyword search
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  content='memories',
  content_rowid='rowid',
  tokenize='porter'
);

-- Trigger to keep FTS index in sync
CREATE TRIGGER IF NOT EXISTS memories_fts_insert 
AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_fts_delete
AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content) 
  VALUES ('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_fts_update
AFTER UPDATE OF content ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content) 
  VALUES ('delete', old.rowid, old.content);
  INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;
`;

export interface MemoryStoreConfig {
  dbPath: string;
  modelPath?: string | undefined;
  encryption?: { passphrase?: string } | undefined;
}

/**
 * Core memory storage engine.
 * 
 * Usage:
 * ```typescript
 * const store = new MemoryStore({ dbPath: '~/.omnimind/memory.db' });
 * await store.init();
 * 
 * const memory = await store.store("User wants GraphQL API", {
 *   wing: "project-alpha",
 *   room: "architecture",
 *   sourceTool: "claude-code",
 * });
 * 
 * const results = await store.search("GraphQL architecture decisions");
 * ```
 */
export class MemoryStore {
  private db: Database.Database | null = null;
  private embeddingEngine: EmbeddingEngine | null = null;
  private searchEngine: SearchEngine | null = null;
  private crypto: CryptoEngine | null = null;
  private readonly config: MemoryStoreConfig;
  private initialized = false;

  // Prepared statements (reused for performance)
  private stmtInsert!: Database.Statement;
  private stmtSelectById!: Database.Statement;
  private stmtSelectByHash!: Database.Statement;
  private stmtDelete!: Database.Statement;
  private stmtUpdateAccess!: Database.Statement;
  private stmtPin!: Database.Statement;
  private stmtCountByLayer!: Database.Statement;
  private stmtCountAll!: Database.Statement;
  private stmtDbSize!: Database.Statement;

  constructor(config: MemoryStoreConfig) {
    this.config = config;
  }

  /**
   * Initialize the database and engines.
   * Must be called before any other method.
   */
  async init(): Promise<Result<void>> {
    try {
      // Open database
      this.db = new Database(this.config.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');

      // Create tables
      this.db.exec(INIT_SQL);

      // Try to load VSS extension (optional — graceful fallback)
      try {
        this.db.exec(VSS_SQL);
      } catch {
        console.warn('[MemoryStore] sqlite-vss extension not available — vector search will use fallback');
      }

      // Create FTS5
      this.db.exec(FTS_SQL);

      // Initialize embedding engine
      this.embeddingEngine = new EmbeddingEngine(this.config.modelPath ? { modelPath: this.config.modelPath } : {});
      await this.embeddingEngine.init();

      // Initialize search engine
      this.searchEngine = new SearchEngine(this.db, this.embeddingEngine);

      // Prepare statements
      this.prepareStatements();

      this.initialized = true;
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Store a new memory */
  async store(content: string, meta: MemoryMeta): Promise<Result<Memory>> {
    if (!this.initialized) return err(new Error('Store not initialized'));

    try {
      const now = Date.now();
      const contentHash = createHash('sha256').update(content).digest('hex');

      // Check for duplicate by hash
      const existing = this.stmtSelectByHash.get(contentHash) as
        | { id: string }
        | undefined;
      if (existing) {
        // Return existing memory with updated access time
        const mem = await this.get(existing.id);
        if (mem.ok) {
          this.stmtUpdateAccess.run(now, existing.id);
          return ok(mem.value!);
        }
      }

      // Generate embedding
      const embedResult = await this.embeddingEngine!.embed(content);
      if (!embedResult.ok) return err(embedResult.error);

      const id = randomUUID();
      const memory: Memory = {
        id,
        content,
        contentHash,
        embedding: embedResult.value,
        layer: MemoryLayer.Verbatim,
        wing: meta.wing || 'general',
        room: meta.room || 'default',
        sourceTool: meta.sourceTool || 'unknown',
        sourceId: meta.sourceId || null,
        confidence: meta.confidence ?? 1.0,
        createdAt: now,
        accessedAt: now,
        accessCount: 1,
        validFrom: meta.validFrom ?? null,
        validTo: meta.validTo ?? null,
        pinned: meta.pinned ?? false,
        compressedRef: null,
        conceptRefs: [],
      };

      // Encrypt content if encryption is enabled
      let storedContent = memory.content;
      if (this.crypto) {
        const encrypted = this.crypto.encrypt(memory.content);
        if (!encrypted.ok) return err(encrypted.error);
        storedContent = JSON.stringify(encrypted.value);
      }

      // Insert into database
      this.stmtInsert.run(
        memory.id,
        storedContent,
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

      // Insert into vector search index
      await this.searchEngine!.indexVector(memory.id, memory.embedding);

      // Log activity
      this.logActivity('memory_create', memory.id);

      return ok(memory);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Get a memory by ID */
  async get(id: string): Promise<Result<Memory | null>> {
    if (!this.initialized) return err(new Error('Store not initialized'));

    try {
      const row = this.stmtSelectById.get(id) as RawMemoryRow | undefined;
      if (!row) return ok(null);

      const memory = this.rowToMemory(row);
      return ok(memory);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Update a memory's mutable fields */
  async update(id: string, updates: Partial<Pick<Memory, 'content' | 'wing' | 'room' | 'pinned' | 'validFrom' | 'validTo'>>): Promise<Result<Memory>> {
    if (!this.initialized) return err(new Error('Store not initialized'));

    try {
      const sets: string[] = [];
      const params: unknown[] = [];

      if (updates.content !== undefined) {
        sets.push('content = ?');
        params.push(updates.content);
        sets.push('content_hash = ?');
        params.push(createHash('sha256').update(updates.content).digest('hex'));
      }
      if (updates.wing !== undefined) {
        sets.push('wing = ?');
        params.push(updates.wing);
      }
      if (updates.room !== undefined) {
        sets.push('room = ?');
        params.push(updates.room);
      }
      if (updates.pinned !== undefined) {
        sets.push('pinned = ?');
        params.push(updates.pinned ? 1 : 0);
      }
      if (updates.validFrom !== undefined) {
        sets.push('valid_from = ?');
        params.push(updates.validFrom);
      }
      if (updates.validTo !== undefined) {
        sets.push('valid_to = ?');
        params.push(updates.validTo);
      }

      if (sets.length === 0) {
        return await this.get(id) as Result<Memory>;
      }

      params.push(id);
      this.db!.prepare(`UPDATE memories SET ${sets.join(', ')} WHERE id = ?`).run(...params);

      return await this.get(id) as Result<Memory>;
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Delete a memory by ID */
  async delete(id: string): Promise<Result<void>> {
    if (!this.initialized) return err(new Error('Store not initialized'));

    try {
      this.stmtDelete.run(id);
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Pin a memory (prevent aging) */
  async pin(id: string): Promise<Result<void>> {
    if (!this.initialized) return err(new Error('Store not initialized'));

    try {
      this.stmtPin.run(1, id);
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Unpin a memory (allow aging) */
  async unpin(id: string): Promise<Result<void>> {
    if (!this.initialized) return err(new Error('Store not initialized'));

    try {
      this.stmtPin.run(0, id);
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Search memories using hybrid search (semantic + keyword).
   * 
   * This is the primary search method — it combines vector similarity
   * with full-text keyword search and fuses the results.
   */
  async search(query: string, opts: SearchOptions = {}): Promise<Result<SearchResult[]>> {
    if (!this.initialized) return err(new Error('Store not initialized'));

    const startTime = performance.now();

    try {
      // Get embedding for query
      const embedResult = await this.embeddingEngine!.embed(query);
      if (!embedResult.ok) return err(embedResult.error);

      // Build filter SQL
      const { whereClause, params } = this.buildFilter(opts);
      const limit = opts.limit ?? DefaultSearchConfig.limit;

      // Vector search (fetch more for fusion)
      const vectorResults = await this.searchEngine!.vectorSearch(
        embedResult.value,
        limit * 2,
        whereClause,
        params,
      );

      // Keyword search (FTS5) (fetch more for fusion)
      const keywordResults = await this.searchEngine!.keywordSearch(
        query,
        limit * 2,
        whereClause,
        params,
      );

      // Fuse results and apply final limit
      let fused = this.fuseResults(vectorResults, keywordResults).slice(0, limit);

      // Temporal boosting
      if (opts.boostRecent ?? DefaultSearchConfig.boostRecent) {
        const halfLife = opts.temporalHalfLife ?? DefaultSearchConfig.temporalHalfLife;
        fused = this.applyTemporalBoost(fused, halfLife);
      }

      // Update access times for returned memories
      const now = Date.now();
      for (const result of fused.slice(0, 5)) {
        this.stmtUpdateAccess.run(now, result.memory.id);
      }

      // Log search activity
      this.logActivity('memory_search', null, query);

      const latency = performance.now() - startTime;
      if (latency > 50) {
        console.warn(`[MemoryStore] Slow search: ${latency.toFixed(1)}ms for "${query.substring(0, 50)}"`);
      }

      return ok(fused);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Get store statistics */
  async getStats(): Promise<Result<StoreStats>> {
    if (!this.initialized) return err(new Error('Store not initialized'));

    try {
      const totalRow = this.stmtCountAll.get() as { count: number };
      const sizeRow = this.stmtDbSize.get() as { size: number };

      const byLayer: Record<MemoryLayerId, number> = {
        [MemoryLayer.Verbatim]: 0,
        [MemoryLayer.Compressed]: 0,
        [MemoryLayer.Concept]: 0,
        [MemoryLayer.Wisdom]: 0,
      };

      const layerRows = this.stmtCountByLayer.all() as Array<{ layer: number; count: number }>;
      for (const row of layerRows) {
        byLayer[row.layer as MemoryLayerId] = row.count;
      }

      const entityRow = this.db!.prepare('SELECT COUNT(*) as count FROM entities').get() as { count: number };
      const relationRow = this.db!.prepare('SELECT COUNT(*) as count FROM relations').get() as { count: number };

      const stats: StoreStats = {
        totalMemories: totalRow.count,
        memoriesByLayer: byLayer,
        totalEntities: entityRow.count,
        totalRelations: relationRow.count,
        databaseSizeBytes: sizeRow.size,
        avgRetrievalLatencyMs: 0, // TODO: track moving average
      };

      return ok(stats);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Close the database connection */
  close(): void {
    this.db?.close();
    this.initialized = false;
  }

  // ─── Private helpers ──────────────────────────────────────────────

  private prepareStatements(): void {
    this.stmtInsert = this.db!.prepare(`
      INSERT INTO memories 
      (id, content, content_hash, embedding, layer, wing, room, source_tool, source_id, 
       confidence, created_at, accessed_at, access_count, valid_from, valid_to, 
       pinned, compressed_ref, concept_refs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtSelectById = this.db!.prepare(`
      SELECT * FROM memories WHERE id = ?
    `);

    this.stmtSelectByHash = this.db!.prepare(`
      SELECT id FROM memories WHERE content_hash = ?
    `);

    this.stmtDelete = this.db!.prepare(`
      DELETE FROM memories WHERE id = ?
    `);

    this.stmtUpdateAccess = this.db!.prepare(`
      UPDATE memories 
      SET accessed_at = ?, access_count = access_count + 1 
      WHERE id = ?
    `);

    this.stmtPin = this.db!.prepare(`
      UPDATE memories SET pinned = ? WHERE id = ?
    `);

    this.stmtCountByLayer = this.db!.prepare(`
      SELECT layer, COUNT(*) as count FROM memories GROUP BY layer
    `);

    this.stmtCountAll = this.db!.prepare(`
      SELECT COUNT(*) as count FROM memories
    `);

    this.stmtDbSize = this.db!.prepare(`
      SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()
    `);
  }

  private rowToMemory(row: RawMemoryRow): Memory {
    return {
      id: row.id,
      content: row.content,
      contentHash: row.content_hash,
      embedding: row.embedding
        ? new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4)
        : new Float32Array(0),      layer: row.layer as MemoryLayerId,
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

  private buildFilter(opts: SearchOptions): { whereClause: string; params: unknown[] } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    // Layer filter
    if (opts.layer !== undefined) {
      if (Array.isArray(opts.layer)) {
        conditions.push(`layer IN (${opts.layer.map(() => '?').join(',')})`);
        params.push(...opts.layer);
      } else {
        conditions.push('layer = ?');
        params.push(opts.layer);
      }
    }

    // Wing filter
    if (opts.wing) {
      conditions.push('wing = ?');
      params.push(opts.wing);
    }

    // Room filter
    if (opts.room) {
      conditions.push('room = ?');
      params.push(opts.room);
    }

    // Time range
    if (opts.timeRange) {
      conditions.push('created_at BETWEEN ? AND ?');
      params.push(opts.timeRange[0], opts.timeRange[1]);
    }

    // Exclude expired facts
    if (!opts.includeExpired) {
      conditions.push('(valid_to IS NULL OR valid_to > ?)');
      params.push(Date.now());
    }

    const whereClause = conditions.length > 0
      ? 'WHERE ' + conditions.join(' AND ')
      : '';

    return { whereClause, params };
  }

  private fuseResults(
    vectorResults: SearchResult[],
    keywordResults: SearchResult[],
  ): SearchResult[] {
    const scores = new Map<string, { memory: Memory; vScore: number; kScore: number }>();

    // Vector scores (alpha weight)
    const vMax = Math.max(...vectorResults.map(r => r.score), 1);
    for (const r of vectorResults) {
      scores.set(r.memory.id, {
        memory: r.memory,
        vScore: (DefaultSearchConfig.hybridAlpha * r.score) / vMax,
        kScore: 0,
      });
    }

    // Keyword scores ((1-alpha) weight)
    const kMax = Math.max(...keywordResults.map(r => r.score), 1);
    for (const r of keywordResults) {
      const existing = scores.get(r.memory.id);
      if (existing) {
        existing.kScore = ((1 - DefaultSearchConfig.hybridAlpha) * r.score) / kMax;
      } else {
        scores.set(r.memory.id, {
          memory: r.memory,
          vScore: 0,
          kScore: ((1 - DefaultSearchConfig.hybridAlpha) * r.score) / kMax,
        });
      }
    }

    // Combine and sort
    return Array.from(scores.values())
      .map(({ memory, vScore, kScore }) => ({
        memory,
        score: vScore + kScore,
        matchType: (vScore > 0 && kScore > 0 ? 'hybrid' : vScore > 0 ? 'vector' : 'keyword') as
          'vector' | 'keyword' | 'hybrid',
      }))
      .sort((a, b) => b.score - a.score);
  }

  private applyTemporalBoost(results: SearchResult[], halfLife: number): SearchResult[] {
    const now = Date.now();
    return results
      .map(r => {
        const age = now - r.memory.createdAt;
        const decay = Math.exp(-age / halfLife);
        const boostedScore = r.score * (0.5 + 0.5 * decay);
        return { ...r, score: boostedScore };
      })
      .sort((a, b) => b.score - a.score);
  }

  private logActivity(
    type: string,
    memoryId: string | null = null,
    contextHash: string | null = null,
  ): void {
    try {
      this.db!.prepare(`
        INSERT INTO activity_log (timestamp, activity_type, context_hash, memory_id)
        VALUES (?, ?, ?, ?)
      `).run(Date.now(), type, contextHash, memoryId);
    } catch {
      // Non-critical — don't fail on logging errors
    }
  }
}

/** Raw database row shape */
interface RawMemoryRow {
  id: string;
  content: string;
  content_hash: string;
  embedding: Buffer | null;
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
