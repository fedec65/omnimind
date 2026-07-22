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
import * as sqlite_vss from 'sqlite-vss';
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
  type Entity,
  type Relation,
  type EntityType,
  type WisdomPattern,
  type ArchivedMemory,
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
  content_hash    TEXT NOT NULL,
  embedding       BLOB,                -- 384-dim Float32Array as buffer
  layer           INTEGER NOT NULL DEFAULT 0,
  wing            TEXT NOT NULL DEFAULT 'general',
  room            TEXT NOT NULL DEFAULT 'default',
  source_tool     TEXT NOT NULL DEFAULT 'unknown',
  namespace       TEXT NOT NULL DEFAULT 'default',
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

-- Archive for evicted memories (preserves data without cluttering active search)
CREATE TABLE IF NOT EXISTS memories_archive (
  id              TEXT PRIMARY KEY,
  content         TEXT NOT NULL,
  content_hash    TEXT NOT NULL,
  embedding       BLOB,
  layer           INTEGER NOT NULL DEFAULT 0,
  wing            TEXT NOT NULL DEFAULT 'general',
  room            TEXT NOT NULL DEFAULT 'default',
  namespace       TEXT NOT NULL DEFAULT 'default',
  source_tool     TEXT NOT NULL DEFAULT 'unknown',
  source_id       TEXT,
  confidence      REAL NOT NULL DEFAULT 1.0,
  created_at      INTEGER NOT NULL,
  last_accessed_at INTEGER NOT NULL,
  access_count    INTEGER NOT NULL DEFAULT 0,
  archived_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_archive_namespace ON memories_archive(namespace);
CREATE INDEX IF NOT EXISTS idx_archive_archived_at ON memories_archive(archived_at);

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

-- Settings table
CREATE TABLE IF NOT EXISTS settings (
  key             TEXT PRIMARY KEY,
  value           TEXT NOT NULL,
  updated_at      INTEGER NOT NULL
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
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);

-- Cross-project wisdom patterns (aggregated from L3 + relations across namespaces)
CREATE TABLE IF NOT EXISTS wisdom_patterns (
  id              TEXT PRIMARY KEY,
  pattern         TEXT NOT NULL,
  predicate       TEXT NOT NULL,
  subject_type    TEXT NOT NULL DEFAULT 'unknown',
  object_type     TEXT NOT NULL DEFAULT 'unknown',
  frequency       INTEGER NOT NULL DEFAULT 1,
  namespaces      TEXT NOT NULL DEFAULT '[]', -- JSON array
  first_seen      INTEGER NOT NULL,
  last_seen       INTEGER NOT NULL,
  example_memory_ids TEXT NOT NULL DEFAULT '[]' -- JSON array
);
CREATE INDEX IF NOT EXISTS idx_wisdom_predicate ON wisdom_patterns(predicate);
CREATE INDEX IF NOT EXISTS idx_wisdom_frequency ON wisdom_patterns(frequency DESC);
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
  /** Optional external embedding engine (avoids re-loading models) */
  embeddingEngine?: EmbeddingEngine | undefined;
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
  private retrievalLatencies: number[] = [];

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
  private stmtUpsertEntity!: Database.Statement;
  private stmtInsertRelation!: Database.Statement;
  private stmtSelectEntity!: Database.Statement;

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
      // Tolerate concurrent writers (app sidecar + MCP server + CLI share
      // the same database file): wait up to 3s on lock contention instead
      // of failing immediately with SQLITE_BUSY.
      this.db.pragma('busy_timeout = 3000');
      this.db.pragma('foreign_keys = ON');

      // Create tables
      this.db.exec(INIT_SQL);

      // Migration: add namespace column if missing (backward compat)
      const columns = this.db.pragma("table_info(memories)") as Array<{ name: string }>;
      if (!columns.some((c) => c.name === 'namespace')) {
        this.db.exec("ALTER TABLE memories ADD COLUMN namespace TEXT NOT NULL DEFAULT 'default'");
        this.db.exec("CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories(namespace)");
      }

      // Try to load VSS extension (optional — graceful fallback)
      try {
        sqlite_vss.load(this.db);
        this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vss_memories USING vss0(embedding(384))`);
      } catch {
        console.warn('[MemoryStore] sqlite-vss extension not available — vector search will use fallback');
      }

      // Create FTS5
      this.db.exec(FTS_SQL);

      // Initialize embedding engine (use external if provided)
      if (this.config.embeddingEngine) {
        this.embeddingEngine = this.config.embeddingEngine;
      } else {
        this.embeddingEngine = new EmbeddingEngine();
        await this.embeddingEngine.init();
      }

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

      const namespace = meta.namespace ?? 'default';

      // Check for duplicate by hash (namespace-scoped)
      const existing = this.stmtSelectByHash.get(contentHash, namespace) as
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
        namespace,
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
        memory.namespace,
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

  /**
   * Store multiple turns from a conversation as separate memories.
   *
   * Each turn gets its own embedding and row, but shares the same
   * `sourceId` (the parent session id). This enables fine-grained
   * retrieval while keeping session-level grouping.
   *
   * Uses batch embedding and a single SQLite transaction for speed.
   */
  async storeTurns(turns: string[], meta: MemoryMeta): Promise<Result<Memory[]>> {
    if (!this.initialized) return err(new Error('Store not initialized'));
    if (turns.length === 0) return ok([]);

    try {
      const now = Date.now();
      const parentSourceId = meta.sourceId || randomUUID();
      const namespace = meta.namespace ?? 'default';

      // ── Deduplication: filter out turns already in DB or duplicated in batch ──
      const seenHashes = new Set<string>();
      const uniqueTurns: Array<{ index: number; content: string; contentHash: string }> = [];

      for (let i = 0; i < turns.length; i++) {
        const content = turns[i]!.trim();
        if (!content) continue;
        const contentHash = createHash('sha256').update(content).digest('hex');

        // Skip duplicates within the same batch
        if (seenHashes.has(contentHash)) continue;
        seenHashes.add(contentHash);

        // Skip if already exists in this namespace
        const existing = this.stmtSelectByHash.get(contentHash, namespace) as
          | { id: string }
          | undefined;
        if (existing) continue;

        uniqueTurns.push({ index: i, content, contentHash });
      }

      if (uniqueTurns.length === 0) {
        return ok([]);
      }

      // Generate embeddings only for unique turns
      const embedResult = await this.embeddingEngine!.embedBatch(uniqueTurns.map((t) => t.content));
      if (!embedResult.ok) return err(embedResult.error);

      const memories: Memory[] = [];
      const turnData: Array<{
        id: string;
        content: string;
        contentHash: string;
        embedding: Float32Array;
      }> = [];

      for (let i = 0; i < uniqueTurns.length; i++) {
        const { content, contentHash } = uniqueTurns[i]!;
        const id = randomUUID();
        const embedding = embedResult.value[i]!;

        memories.push({
          id,
          content,
          contentHash,
          embedding,
          layer: MemoryLayer.Verbatim,
          wing: meta.wing || 'general',
          room: meta.room || 'default',
          sourceTool: meta.sourceTool || 'unknown',
          namespace,
          sourceId: parentSourceId,
          confidence: meta.confidence ?? 1.0,
          createdAt: now,
          accessedAt: now,
          accessCount: 1,
          validFrom: meta.validFrom ?? null,
          validTo: meta.validTo ?? null,
          pinned: meta.pinned ?? false,
          compressedRef: null,
          conceptRefs: [],
        });

        turnData.push({ id, content, contentHash, embedding });
      }

      // Encrypt content if encryption is enabled
      let storedTurns = turnData.map((t) => t.content);
      if (this.crypto) {
        storedTurns = [];
        for (const t of turnData) {
          const encrypted = this.crypto.encrypt(t.content);
          if (!encrypted.ok) return err(encrypted.error);
          storedTurns.push(JSON.stringify(encrypted.value));
        }
      }

      // Insert all turns in a single transaction
      const insertTx = this.db!.transaction(
        (
          items: Array<{
            id: string;
            content: string;
            contentHash: string;
            embedding: Float32Array;
          }>,
        ) => {
          for (let i = 0; i < items.length; i++) {
            const item = items[i]!;
            this.stmtInsert.run(
              item.id,
              item.content,
              item.contentHash,
              Buffer.from(item.embedding.buffer),
              MemoryLayer.Verbatim,
              meta.wing || 'general',
              meta.room || 'default',
              meta.sourceTool || 'unknown',
              namespace,
              parentSourceId,
              meta.confidence ?? 1.0,
              now,
              now,
              1,
              meta.validFrom ?? null,
              meta.validTo ?? null,
              meta.pinned ? 1 : 0,
              null,
              JSON.stringify([]),
            );
          }
        },
      );

      insertTx(
        turnData.map((t, i) => ({
          id: t.id,
          content: storedTurns[i]!,
          contentHash: t.contentHash,
          embedding: t.embedding,
        })),
      );

      // Index vectors in batch (much faster)
      await this.searchEngine!.indexVectorsBatch(
        memories.map((m) => ({ memoryId: m.id, embedding: m.embedding })),
      );

      // Log activity once for the batch
      this.logActivity('memory_create_batch', parentSourceId);

      return ok(memories);
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

  /** Get all memory IDs (for bulk operations like aging) */
  getAllMemoryIds(): Result<string[]> {
    if (!this.initialized) return err(new Error('Store not initialized'));
    try {
      const rows = this.db!.prepare('SELECT id FROM memories').all() as { id: string }[];
      return ok(rows.map((r) => r.id));
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Update a memory's mutable fields */
  async update(id: string, updates: Partial<Pick<Memory, 'content' | 'wing' | 'room' | 'pinned' | 'validFrom' | 'validTo' | 'layer' | 'conceptRefs' | 'compressedRef'>>): Promise<Result<Memory>> {
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
      if (updates.layer !== undefined) {
        sets.push('layer = ?');
        params.push(updates.layer);
      }
      if (updates.conceptRefs !== undefined) {
        sets.push('concept_refs = ?');
        params.push(JSON.stringify(updates.conceptRefs));
      }
      if (updates.compressedRef !== undefined) {
        sets.push('compressed_ref = ?');
        params.push(updates.compressedRef);
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

      // Vector search (fetch more for fusion; fetch even more when vector-only)
      const vectorFetchLimit = opts.vectorOnly ? limit * 10 : limit * 2;
      const vectorResults = await this.searchEngine!.vectorSearch(
        embedResult.value,
        vectorFetchLimit,
        whereClause,
        params,
      );

      // Keyword search (FTS5) (fetch more for fusion) — skip if vectorOnly
      let fused: SearchResult[];
      if (opts.vectorOnly) {
        fused = vectorResults.slice(0, limit);
      } else {
        const keywordResults = await this.searchEngine!.keywordSearch(
          query,
          limit * 2,
          whereClause,
          params,
        );
        fused = this.fuseResults(vectorResults, keywordResults, query).slice(0, limit);
      }

      // Graph search — augment with memories linked to matching entities
      const graphResults = await this.searchEngine!.graphSearch(query, limit);
      if (graphResults.length > 0) {
        const existingIds = new Set(fused.map(r => r.memory.id));
        for (const g of graphResults) {
          if (!existingIds.has(g.memory.id)) {
            fused.push(g);
          }
        }
        // Re-sort by score (graph matches get a moderate boost)
        fused = fused
          .map(r => r.matchType === 'graph' ? { ...r, score: r.score * 1.1 } : r)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
      }

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
      this.retrievalLatencies.push(latency);
      if (this.retrievalLatencies.length > 100) {
        this.retrievalLatencies.shift();
      }
      if (latency > 50) {
        console.warn(`[MemoryStore] Slow search: ${latency.toFixed(1)}ms for "${query.substring(0, 50)}"`);
      }

      return ok(fused);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Export all memories as a serializable JSON-compatible array */
  exportMemories(): Result<Array<{
    id: string;
    content: string;
    layer: number;
    wing: string;
    room: string;
    sourceTool: string;
    sourceId: string | null;
    confidence: number;
    createdAt: number;
    accessedAt: number;
    accessCount: number;
    validFrom: number | null;
    validTo: number | null;
    pinned: boolean;
    compressedRef: string | null;
    conceptRefs: string[];
    embedding: number[];
  }>> {
    if (!this.initialized) return err(new Error('Store not initialized'));
    try {
      const rows = this.db!.prepare('SELECT * FROM memories ORDER BY created_at').all() as RawMemoryRow[];
      const exported = rows.map(row => ({
        id: row.id,
        content: row.content,
        layer: row.layer,
        wing: row.wing,
        room: row.room,
        sourceTool: row.source_tool,
        namespace: row.namespace,
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
        embedding: row.embedding
          ? Array.from(new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4))
          : [],
      }));
      return ok(exported);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Import memories from a serializable array.
   *
   * Skips duplicates by content hash. Re-indexes vectors automatically.
   */
  async importMemories(
    data: Array<{
      id: string;
      content: string;
      layer: number;
      wing: string;
      room: string;
      sourceTool: string;
      namespace: string;
      sourceId: string | null;
      confidence: number;
      createdAt: number;
      accessedAt: number;
      accessCount: number;
      validFrom: number | null;
      validTo: number | null;
      pinned: boolean;
      compressedRef: string | null;
      conceptRefs: string[];
      embedding: number[];
    }>,
  ): Promise<Result<number>> {
    if (!this.initialized) return err(new Error('Store not initialized'));

    try {
      let imported = 0;
      const insertTx = this.db!.transaction((items: Array<{
        id: string; content: string; contentHash: string; embedding: Float32Array; layer: number;
        wing: string; room: string; sourceTool: string; namespace: string; sourceId: string | null;
        confidence: number; createdAt: number; accessedAt: number; accessCount: number;
        validFrom: number | null; validTo: number | null; pinned: number;
        compressedRef: string | null; conceptRefs: string;
      }>) => {
        for (const item of items) {
          // Skip duplicates by hash (namespace-scoped)
          const ns = item.namespace ?? 'default';
          const existing = this.stmtSelectByHash.get(item.contentHash, ns) as { id: string } | undefined;
          if (existing) continue;

          this.stmtInsert.run(
            item.id, item.content, item.contentHash,
            Buffer.from(item.embedding.buffer),
            item.layer, item.wing, item.room, item.sourceTool, item.namespace ?? 'default', item.sourceId,
            item.confidence, item.createdAt, item.accessedAt, item.accessCount,
            item.validFrom, item.validTo, item.pinned,
            item.compressedRef, item.conceptRefs,
          );
          imported++;
        }
      });

      const items = [];
      for (const mem of data) {
        const contentHash = createHash('sha256').update(mem.content).digest('hex');
        let embedding: Float32Array;
        if (mem.embedding.length > 0) {
          embedding = new Float32Array(mem.embedding);
        } else {
          const embedResult = await this.embeddingEngine!.embed(mem.content);
          embedding = embedResult.ok ? embedResult.value : new Float32Array(0);
        }

        items.push({
          id: mem.id,
          content: mem.content,
          contentHash,
          embedding,
          layer: mem.layer,
          wing: mem.wing,
          room: mem.room,
          sourceTool: mem.sourceTool,
          namespace: mem.namespace ?? 'default',
          sourceId: mem.sourceId,
          confidence: mem.confidence,
          createdAt: mem.createdAt,
          accessedAt: mem.accessedAt,
          accessCount: mem.accessCount,
          validFrom: mem.validFrom,
          validTo: mem.validTo,
          pinned: mem.pinned ? 1 : 0,
          compressedRef: mem.compressedRef,
          conceptRefs: JSON.stringify(mem.conceptRefs),
        });
      }

      insertTx(items);

      // Index vectors for imported memories
      for (const mem of data) {
        const embedding = mem.embedding.length > 0 ? new Float32Array(mem.embedding) : null;
        if (embedding) {
          await this.searchEngine!.indexVector(mem.id, embedding);
        }
      }

      return ok(imported);
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
        avgRetrievalLatencyMs: this.retrievalLatencies.length > 0
          ? this.retrievalLatencies.reduce((a, b) => a + b, 0) / this.retrievalLatencies.length
          : 0,
      };

      return ok(stats);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  // ─── Memory Eviction / Archive ────────────────────────────────────

  /**
   * Archive stale memories to keep the active index lean.
   *
   * Memories matching the criteria are COPIED to `memories_archive`
   * and then DELETED from `memories`. Pinned memories are never
   * evicted. Only L0/L1 are evicted by default.
   */
  evictStaleMemories(opts: {
    maxAgeDays?: number | undefined;
    layer?: MemoryLayerId | MemoryLayerId[] | undefined;
    limit?: number | undefined;
  } = {}): Result<number> {
    if (!this.initialized) return err(new Error('Store not initialized'));

    try {
      const maxAgeDays = opts.maxAgeDays ?? 90;
      const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
      const layers = opts.layer !== undefined
        ? (Array.isArray(opts.layer) ? opts.layer : [opts.layer])
        : [MemoryLayer.Verbatim, MemoryLayer.Compressed];
      const limit = opts.limit ?? 1000;

      // Find candidates (not pinned, old enough, matching layers)
      const layerPlaceholders = layers.map(() => '?').join(',');
      const candidates = this.db!.prepare(
        `SELECT * FROM memories
         WHERE pinned = 0 AND accessed_at < ? AND layer IN (${layerPlaceholders})
         ORDER BY accessed_at ASC
         LIMIT ?`,
      ).all(cutoff, ...layers, limit) as Array<{
        id: string; content: string; content_hash: string; embedding: Buffer;
        layer: number; wing: string; room: string; namespace: string;
        source_tool: string; source_id: string | null; confidence: number;
        created_at: number; accessed_at: number | null; access_count: number;
      }>;

      if (candidates.length === 0) return ok(0);

      // Remove from vector index BEFORE deleting from memories
      for (const row of candidates) {
        this.searchEngine!.deleteVector(row.id);
      }

      const archiveStmt = this.db!.prepare(
        `INSERT INTO memories_archive (
          id, content, content_hash, embedding, layer, wing, room, namespace,
          source_tool, source_id, confidence, created_at, last_accessed_at,
          access_count, archived_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      const deleteStmt = this.db!.prepare('DELETE FROM memories WHERE id = ?');

      const tx = this.db!.transaction((items: typeof candidates) => {
        for (const row of items) {
          archiveStmt.run(
            row.id, row.content, row.content_hash, row.embedding,
            row.layer, row.wing, row.room, row.namespace,
            row.source_tool, row.source_id, row.confidence,
            row.created_at, row.accessed_at ?? 0, row.access_count,
            Date.now(),
          );
          deleteStmt.run(row.id);
          // FTS trigger will auto-remove from memories_fts on DELETE
        }
      });

      tx(candidates);

      // Remove from vector index
      for (const row of candidates) {
        this.searchEngine!.deleteVector(row.id);
      }

      return ok(candidates.length);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Statistics about the archive */
  getArchiveStats(): Result<{ totalArchived: number; oldestArchive: number | null }> {
    if (!this.initialized) return err(new Error('Store not initialized'));
    try {
      const countRow = this.db!.prepare('SELECT COUNT(*) as count FROM memories_archive').get() as { count: number };
      const oldestRow = this.db!.prepare('SELECT MIN(archived_at) as oldest FROM memories_archive').get() as { oldest: number | null };
      return ok({ totalArchived: countRow.count, oldestArchive: oldestRow.oldest });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  // ─── Archive Operations ───────────────────────────────────────────

  /** List archived memories with optional namespace filter and pagination */
  listArchive(opts: { namespace?: string | undefined; limit?: number | undefined; offset?: number | undefined } = {}): Result<ArchivedMemory[]> {
    if (!this.initialized) return err(new Error('Store not initialized'));
    try {
      const conditions: string[] = [];
      const params: (string | number)[] = [];
      if (opts.namespace) {
        conditions.push('namespace = ?');
        params.push(opts.namespace);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;
      params.push(limit, offset);
      const rows = this.db!.prepare(
        `SELECT * FROM memories_archive ${where} ORDER BY archived_at DESC LIMIT ? OFFSET ?`
      ).all(...params) as Array<{
        id: string; content: string; content_hash: string; embedding: Buffer | null;
        layer: number; wing: string; room: string; namespace: string;
        source_tool: string; source_id: string | null; confidence: number;
        created_at: number; last_accessed_at: number; access_count: number;
        archived_at: number;
      }>;
      const memories: ArchivedMemory[] = rows.map(r => ({
        id: r.id,
        content: r.content,
        contentHash: r.content_hash,
        embedding: r.embedding ? new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4) : new Float32Array(384),
        layer: r.layer as MemoryLayerId,
        wing: r.wing,
        room: r.room,
        namespace: r.namespace,
        sourceTool: r.source_tool,
        sourceId: r.source_id,
        confidence: r.confidence,
        createdAt: r.created_at,
        lastAccessedAt: r.last_accessed_at,
        accessCount: r.access_count,
        archivedAt: r.archived_at,
      }));
      return ok(memories);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Search archived memories by content substring */
  searchArchive(query: string, opts: { namespace?: string | undefined; limit?: number | undefined } = {}): Result<ArchivedMemory[]> {
    if (!this.initialized) return err(new Error('Store not initialized'));
    try {
      const conditions: string[] = ["content LIKE ?"];
      const params: (string | number)[] = [`%${query}%`];
      if (opts.namespace) {
        conditions.push('namespace = ?');
        params.push(opts.namespace);
      }
      const limit = opts.limit ?? 50;
      params.push(limit);
      const rows = this.db!.prepare(
        `SELECT * FROM memories_archive WHERE ${conditions.join(' AND ')} ORDER BY archived_at DESC LIMIT ?`
      ).all(...params) as Array<{
        id: string; content: string; content_hash: string; embedding: Buffer | null;
        layer: number; wing: string; room: string; namespace: string;
        source_tool: string; source_id: string | null; confidence: number;
        created_at: number; last_accessed_at: number; access_count: number;
        archived_at: number;
      }>;
      const memories: ArchivedMemory[] = rows.map(r => ({
        id: r.id,
        content: r.content,
        contentHash: r.content_hash,
        embedding: r.embedding ? new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4) : new Float32Array(384),
        layer: r.layer as MemoryLayerId,
        wing: r.wing,
        room: r.room,
        namespace: r.namespace,
        sourceTool: r.source_tool,
        sourceId: r.source_id,
        confidence: r.confidence,
        createdAt: r.created_at,
        lastAccessedAt: r.last_accessed_at,
        accessCount: r.access_count,
        archivedAt: r.archived_at,
      }));
      return ok(memories);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Restore a single memory from archive back to active memories */
  restoreFromArchive(id: string): Result<Memory> {
    if (!this.initialized) return err(new Error('Store not initialized'));
    try {
      const row = this.db!.prepare('SELECT * FROM memories_archive WHERE id = ?').get(id) as {
        id: string; content: string; content_hash: string; embedding: Buffer | null;
        layer: number; wing: string; room: string; namespace: string;
        source_tool: string; source_id: string | null; confidence: number;
        created_at: number; last_accessed_at: number; access_count: number;
        valid_from: number | null; valid_to: number | null; pinned: number;
        compressed_ref: string | null; concept_refs: string | null;
        archived_at: number;
      } | undefined;
      if (!row) return err(new Error(`Archive entry ${id} not found`));

      const now = Date.now();
      const memory: Memory = {
        id: row.id,
        content: row.content,
        contentHash: row.content_hash,
        embedding: row.embedding ? new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4) : new Float32Array(384),
        layer: row.layer as MemoryLayerId,
        wing: row.wing,
        room: row.room,
        namespace: row.namespace,
        sourceTool: row.source_tool,
        sourceId: row.source_id,
        confidence: row.confidence,
        createdAt: row.created_at,
        accessedAt: now,
        accessCount: row.access_count + 1,
        validFrom: row.valid_from,
        validTo: row.valid_to,
        pinned: row.pinned === 1,
        compressedRef: row.compressed_ref,
        conceptRefs: row.concept_refs ? JSON.parse(row.concept_refs) : [],
      };

      // Check for duplicate in active memories
      const existing = this.stmtSelectByHash.get(memory.contentHash, memory.namespace) as { id: string } | undefined;
      if (existing) {
        this.db!.prepare('DELETE FROM memories_archive WHERE id = ?').run(id);
        return err(new Error(`Duplicate active memory exists: ${existing.id}`));
      }

      const insertStmt = this.db!.prepare(
        `INSERT INTO memories (
          id, content, content_hash, embedding, layer, wing, room, source_tool, namespace,
          source_id, confidence, created_at, accessed_at, access_count, valid_from, valid_to,
          pinned, compressed_ref, concept_refs
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      insertStmt.run(
        memory.id, memory.content, memory.contentHash,
        memory.embedding ? Buffer.from(memory.embedding.buffer) : null,
        memory.layer, memory.wing, memory.room, memory.sourceTool, memory.namespace,
        memory.sourceId, memory.confidence, memory.createdAt, memory.accessedAt,
        memory.accessCount, memory.validFrom, memory.validTo,
        memory.pinned ? 1 : 0, memory.compressedRef,
        memory.conceptRefs.length > 0 ? JSON.stringify(memory.conceptRefs) : null
      );

      // Add to vector index
      try {
        const buffer = Buffer.from(memory.embedding.buffer);
        this.db!.prepare(
          'INSERT INTO vss_memories(rowid, embedding) VALUES ((SELECT rowid FROM memories WHERE id = ?), ?)',
        ).run(memory.id, buffer);
      } catch {
        // VSS insert failed — non-critical
      }

      // Remove from archive
      this.db!.prepare('DELETE FROM memories_archive WHERE id = ?').run(id);

      return ok(memory);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Restore multiple archived memories (batch) */
  restoreAllFromArchive(opts: { namespace?: string | undefined; limit?: number | undefined } = {}): Result<number> {
    if (!this.initialized) return err(new Error('Store not initialized'));
    try {
      const listResult = this.listArchive({ namespace: opts.namespace, limit: opts.limit ?? 100 });
      if (!listResult.ok) return listResult;
      let restored = 0;
      for (const archived of listResult.value) {
        const res = this.restoreFromArchive(archived.id);
        if (res.ok) restored++;
      }
      return ok(restored);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  // ─── Wisdom Patterns ──────────────────────────────────────────────

  /** Aggregate cross-project wisdom patterns from relations and L3 memories */
  aggregateWisdomPatterns(minFrequency: number = 2): Result<number> {
    if (!this.initialized) return err(new Error('Store not initialized'));
    try {
      // Aggregate from relations joined with entity types
      const rows = this.db!.prepare(`
        SELECT
          r.predicate,
          e1.type as subject_type,
          e2.type as object_type,
          COUNT(*) as freq,
          GROUP_CONCAT(DISTINCT m.namespace) as namespaces,
          MIN(r.valid_from) as first_seen,
          MAX(r.valid_from) as last_seen,
          GROUP_CONCAT(DISTINCT r.source_memory) as example_ids
        FROM relations r
        JOIN entities e1 ON e1.id = r.subject_id
        JOIN entities e2 ON e2.id = r.object_id
        LEFT JOIN memories m ON m.id = r.source_memory
        GROUP BY r.predicate, e1.type, e2.type
        HAVING freq >= ?
      `).all(minFrequency) as Array<{
        predicate: string;
        subject_type: string;
        object_type: string;
        freq: number;
        namespaces: string | null;
        first_seen: number | null;
        last_seen: number | null;
        example_ids: string | null;
      }>;

      const upsert = this.db!.prepare(`
        INSERT INTO wisdom_patterns (
          id, pattern, predicate, subject_type, object_type, frequency,
          namespaces, first_seen, last_seen, example_memory_ids
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          frequency = excluded.frequency,
          namespaces = excluded.namespaces,
          last_seen = excluded.last_seen,
          example_memory_ids = excluded.example_memory_ids
      `);

      const now = Date.now();
      let count = 0;
      for (const row of rows) {
        const id = `${row.predicate}:${row.subject_type}:${row.object_type}`;
        const ns = row.namespaces ? JSON.stringify(row.namespaces.split(',').filter(Boolean)) : '[]';
        const examples = row.example_ids ? JSON.stringify(row.example_ids.split(',').filter(Boolean).slice(0, 5)) : '[]';
        const patternText = `${row.predicate}(${row.subject_type} → ${row.object_type})`;
        upsert.run(
          id, patternText, row.predicate, row.subject_type, row.object_type,
          row.freq, ns, row.first_seen ?? now, row.last_seen ?? now, examples
        );
        count++;
      }

      return ok(count);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Retrieve wisdom patterns with optional filters */
  getWisdomPatterns(opts: { predicate?: string | undefined; minFrequency?: number | undefined; limit?: number | undefined } = {}): Result<WisdomPattern[]> {
    if (!this.initialized) return err(new Error('Store not initialized'));
    try {
      const conditions: string[] = [];
      const params: (string | number)[] = [];
      if (opts.predicate) {
        conditions.push('predicate = ?');
        params.push(opts.predicate);
      }
      if (opts.minFrequency !== undefined) {
        conditions.push('frequency >= ?');
        params.push(opts.minFrequency);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = opts.limit ?? 50;
      params.push(limit);

      const rows = this.db!.prepare(
        `SELECT * FROM wisdom_patterns ${where} ORDER BY frequency DESC LIMIT ?`
      ).all(...params) as Array<{
        id: string; pattern: string; predicate: string;
        subject_type: string; object_type: string;
        frequency: number; namespaces: string;
        first_seen: number; last_seen: number;
        example_memory_ids: string;
      }>;

      const patterns: WisdomPattern[] = rows.map(r => ({
        id: r.id,
        pattern: r.pattern,
        predicate: r.predicate,
        subjectType: r.subject_type,
        objectType: r.object_type,
        frequency: r.frequency,
        namespaces: JSON.parse(r.namespaces) as string[],
        firstSeen: r.first_seen,
        lastSeen: r.last_seen,
        exampleMemoryIds: JSON.parse(r.example_memory_ids) as string[],
      }));
      return ok(patterns);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  // ─── Graph Queries ────────────────────────────────────────────────

  /** Query entities with optional filters */
  queryEntities(opts: { type?: EntityType | undefined; search?: string | undefined; limit?: number | undefined } = {}): Result<Entity[]> {
    if (!this.initialized) return err(new Error('Store not initialized'));
    try {
      const conditions: string[] = [];
      const params: (string | number)[] = [];
      if (opts.type) {
        conditions.push('type = ?');
        params.push(opts.type);
      }
      if (opts.search) {
        conditions.push('name LIKE ?');
        params.push(`%${opts.search}%`);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = opts.limit ? 'LIMIT ?' : '';
      if (opts.limit) params.push(opts.limit);

      const sql = `SELECT * FROM entities ${where} ORDER BY mention_count DESC ${limit}`;
      const rows = this.db!.prepare(sql).all(...params) as Array<{
        id: string; name: string; type: string; description: string | null;
        first_seen: number; last_seen: number; mention_count: number;
      }>;
      const entities: Entity[] = rows.map(r => ({
        id: r.id,
        name: r.name,
        type: r.type as EntityType,
        description: r.description,
        firstSeen: r.first_seen,
        lastSeen: r.last_seen,
        mentionCount: r.mention_count,
      }));
      return ok(entities);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Query relations with optional filters */
  queryRelations(opts: { subjectId?: string | undefined; objectId?: string | undefined; predicate?: string | undefined; limit?: number | undefined } = {}): Result<Relation[]> {
    if (!this.initialized) return err(new Error('Store not initialized'));
    try {
      const conditions: string[] = [];
      const params: (string | number)[] = [];
      if (opts.subjectId) { conditions.push('subject_id = ?'); params.push(opts.subjectId); }
      if (opts.objectId) { conditions.push('object_id = ?'); params.push(opts.objectId); }
      if (opts.predicate) { conditions.push('predicate = ?'); params.push(opts.predicate); }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = opts.limit ? 'LIMIT ?' : '';
      if (opts.limit) params.push(opts.limit);

      const sql = `SELECT * FROM relations ${where} ${limit}`;
      const rows = this.db!.prepare(sql).all(...params) as Array<{
        id: string; subject_id: string; predicate: string; object_id: string;
        valid_from: number | null; valid_to: number | null;
        source_memory: string | null; confidence: number;
      }>;
      const relations: Relation[] = rows.map(r => ({
        id: r.id,
        subjectId: r.subject_id,
        predicate: r.predicate,
        objectId: r.object_id,
        validFrom: r.valid_from,
        validTo: r.valid_to,
        sourceMemory: r.source_memory,
        confidence: r.confidence,
      }));
      return ok(relations);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Get neighbors of an entity up to a depth */
  getEntityNeighbors(entityId: string, depth: number = 1): Result<{ entity: Entity; relation: Relation }[]> {
    if (!this.initialized) return err(new Error('Store not initialized'));
    try {
      const results: { entity: Entity; relation: Relation }[] = [];
      const visited = new Set<string>([entityId]);
      let currentIds = [entityId];

      for (let d = 0; d < depth; d++) {
        const nextIds: string[] = [];
        for (const id of currentIds) {
          const rels = this.db!.prepare(
            `SELECT * FROM relations WHERE subject_id = ? OR object_id = ?`
          ).all(id, id) as Array<{
            id: string; subject_id: string; predicate: string; object_id: string;
            valid_from: number | null; valid_to: number | null;
            source_memory: string | null; confidence: number;
          }>;
          for (const r of rels) {
            const otherId = r.subject_id === id ? r.object_id : r.subject_id;
            if (!visited.has(otherId)) {
              visited.add(otherId);
              const entRow = this.db!.prepare('SELECT * FROM entities WHERE id = ?').get(otherId) as {
                id: string; name: string; type: string; description: string | null;
                first_seen: number; last_seen: number; mention_count: number;
              } | undefined;
              if (entRow) {
                results.push({
                  entity: {
                    id: entRow.id, name: entRow.name, type: entRow.type as EntityType,
                    description: entRow.description, firstSeen: entRow.first_seen,
                    lastSeen: entRow.last_seen, mentionCount: entRow.mention_count,
                  },
                  relation: {
                    id: r.id, subjectId: r.subject_id, predicate: r.predicate,
                    objectId: r.object_id, validFrom: r.valid_from, validTo: r.valid_to,
                    sourceMemory: r.source_memory, confidence: r.confidence,
                  },
                });
                nextIds.push(otherId);
              }
            }
          }
        }
        currentIds = nextIds;
      }
      return ok(results);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Get all relations involving any of the given entity IDs */
  getRelationsForEntities(entityIds: string[]): Result<Relation[]> {
    if (!this.initialized) return err(new Error('Store not initialized'));
    if (entityIds.length === 0) return ok([]);
    try {
      const placeholders = entityIds.map(() => '?').join(',');
      const rows = this.db!.prepare(
        `SELECT * FROM relations WHERE subject_id IN (${placeholders}) OR object_id IN (${placeholders})`,
      ).all(...entityIds, ...entityIds) as Array<{
        id: string; subject_id: string; predicate: string; object_id: string;
        valid_from: number | null; valid_to: number | null;
        source_memory: string | null; confidence: number;
      }>;
      const relations: Relation[] = rows.map((r) => ({
        id: r.id,
        subjectId: r.subject_id,
        predicate: r.predicate,
        objectId: r.object_id,
        validFrom: r.valid_from,
        validTo: r.valid_to,
        sourceMemory: r.source_memory,
        confidence: r.confidence,
      }));
      return ok(relations);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  // ─── Graph Writes ─────────────────────────────────────────────────

  /**
   * Upsert an entity into the knowledge graph.
   *
   * Inserts a new entity or updates `last_seen` and increments
   * `mention_count` if the entity already exists.
   */
  upsertEntity(entity: Omit<Entity, 'firstSeen' | 'lastSeen' | 'mentionCount'> & { firstSeen?: number; lastSeen?: number }): Result<Entity> {
    if (!this.initialized) return err(new Error('Store not initialized'));
    try {
      const now = Date.now();
      this.stmtUpsertEntity.run(
        entity.id,
        entity.name,
        entity.type,
        entity.description ?? null,
        entity.firstSeen ?? now,
        entity.lastSeen ?? now,
      );

      const row = this.stmtSelectEntity.get(entity.id) as {
        id: string; name: string; type: string; description: string | null;
        first_seen: number; last_seen: number; mention_count: number;
      } | undefined;

      if (!row) return err(new Error('Entity upsert failed'));

      return ok({
        id: row.id,
        name: row.name,
        type: row.type as EntityType,
        description: row.description,
        firstSeen: row.first_seen,
        lastSeen: row.last_seen,
        mentionCount: row.mention_count,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Insert a relation into the knowledge graph.
   */
  insertRelation(relation: Omit<Relation, 'id'> & { id?: string }): Result<Relation> {
    if (!this.initialized) return err(new Error('Store not initialized'));
    try {
      const id = relation.id ?? randomUUID();
      this.stmtInsertRelation.run(
        id,
        relation.subjectId,
        relation.predicate,
        relation.objectId,
        relation.validFrom ?? null,
        relation.validTo ?? null,
        relation.sourceMemory ?? null,
        relation.confidence ?? 1.0,
      );

      return ok({
        id,
        subjectId: relation.subjectId,
        predicate: relation.predicate,
        objectId: relation.objectId,
        validFrom: relation.validFrom ?? null,
        validTo: relation.validTo ?? null,
        sourceMemory: relation.sourceMemory ?? null,
        confidence: relation.confidence ?? 1.0,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  // ─── Settings ─────────────────────────────────────────────────────

  /** Get a single setting value */
  getSetting(key: string): Result<string | null> {
    if (!this.initialized) return err(new Error('Store not initialized'));
    try {
      const row = this.db!.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
      return ok(row ? row.value : null);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Set a setting value */
  setSetting(key: string, value: string): Result<void> {
    if (!this.initialized) return err(new Error('Store not initialized'));
    try {
      this.db!.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).run(key, value, Date.now());
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Get all settings as a key-value record */
  getAllSettings(): Result<Record<string, string>> {
    if (!this.initialized) return err(new Error('Store not initialized'));
    try {
      const rows = this.db!.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
      const settings: Record<string, string> = {};
      for (const row of rows) settings[row.key] = row.value;
      return ok(settings);
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
      (id, content, content_hash, embedding, layer, wing, room, source_tool, namespace, source_id, 
       confidence, created_at, accessed_at, access_count, valid_from, valid_to, 
       pinned, compressed_ref, concept_refs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtSelectById = this.db!.prepare(`
      SELECT * FROM memories WHERE id = ?
    `);

    this.stmtSelectByHash = this.db!.prepare(`
      SELECT id FROM memories WHERE content_hash = ? AND namespace = ?
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

    this.stmtUpsertEntity = this.db!.prepare(`
      INSERT INTO entities (id, name, type, description, first_seen, last_seen, mention_count)
      VALUES (?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET
        last_seen = excluded.last_seen,
        mention_count = mention_count + 1
    `);

    this.stmtInsertRelation = this.db!.prepare(`
      INSERT INTO relations (id, subject_id, predicate, object_id, valid_from, valid_to, source_memory, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtSelectEntity = this.db!.prepare(`
      SELECT * FROM entities WHERE id = ?
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
      namespace: row.namespace,
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

    // Namespace filter (single or multiple)
    if (opts.namespaces && opts.namespaces.length > 0) {
      conditions.push(`namespace IN (${opts.namespaces.map(() => '?').join(',')})`);
      params.push(...opts.namespaces);
    } else if (opts.namespace) {
      conditions.push('namespace = ?');
      params.push(opts.namespace);
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
    query: string,
  ): SearchResult[] {
    const scores = new Map<string, { memory: Memory; vScore: number; kScore: number }>();

    // Adaptive hybrid alpha based on query length
    const wordCount = query.split(/\s+/).filter(w => w.length > 0).length;
    const alpha = wordCount <= 2 ? 0.5 : wordCount >= 6 ? 0.85 : DefaultSearchConfig.hybridAlpha;

    // Vector scores (alpha weight)
    const vMax = Math.max(...vectorResults.map(r => r.score), 1);
    for (const r of vectorResults) {
      scores.set(r.memory.id, {
        memory: r.memory,
        vScore: (alpha * r.score) / vMax,
        kScore: 0,
      });
    }

    // Keyword scores ((1-alpha) weight)
    const kMax = Math.max(...keywordResults.map(r => r.score), 1);
    for (const r of keywordResults) {
      const existing = scores.get(r.memory.id);
      if (existing) {
        existing.kScore = ((1 - alpha) * r.score) / kMax;
      } else {
        scores.set(r.memory.id, {
          memory: r.memory,
          vScore: 0,
          kScore: ((1 - alpha) * r.score) / kMax,
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
  namespace: string;
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
