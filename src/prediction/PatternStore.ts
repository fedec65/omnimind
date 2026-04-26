/**
 * PatternStore — SQLite persistence for learned prediction patterns
 *
 * Stores ActivityPatterns so they survive restarts.
 * Load on init, save on recordAccess (debounced, every 5s).
 */

import Database from 'better-sqlite3';
import { type Result, ok, err } from '../core/types.js';

/** A single learned pattern */
export interface StoredPattern {
  readonly contextSignature: string;
  readonly memoryId: string;
  readonly frequency: number;
  readonly lastAccessed: number;
  readonly avgConfidence: number;
}

/** Serialized pattern row in the database */
interface PatternRow {
  context_signature: string;
  memory_id: string;
  frequency: number;
  last_accessed: number;
  avg_confidence: number;
}

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS activity_patterns (
  context_signature TEXT NOT NULL,
  memory_id         TEXT NOT NULL,
  frequency         INTEGER NOT NULL DEFAULT 1,
  last_accessed     INTEGER NOT NULL,
  avg_confidence    REAL NOT NULL DEFAULT 0.5,
  PRIMARY KEY (context_signature, memory_id)
);

CREATE INDEX IF NOT EXISTS idx_patterns_signature ON activity_patterns(context_signature);
CREATE INDEX IF NOT EXISTS idx_patterns_memory ON activity_patterns(memory_id);
CREATE INDEX IF NOT EXISTS idx_patterns_last_accessed ON activity_patterns(last_accessed);
`;

export class PatternStore {
  private db: Database.Database | null = null;
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly flushIntervalMs: number;

  constructor(options: { dbPath: string; flushIntervalMs?: number } = { dbPath: ':memory:' }) {
    this.db = new Database(options.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(INIT_SQL);
    this.flushIntervalMs = options.flushIntervalMs ?? 5000;
  }

  /** Load all patterns from the database */
  load(): StoredPattern[] {
    if (!this.db) return [];
    const rows = this.db.prepare('SELECT * FROM activity_patterns').all() as PatternRow[];
    return rows.map((r) => ({
      contextSignature: r.context_signature,
      memoryId: r.memory_id,
      frequency: r.frequency,
      lastAccessed: r.last_accessed,
      avgConfidence: r.avg_confidence,
    }));
  }

  /** Queue a pattern for persistence (debounced flush) */
  save(pattern: StoredPattern): void {
    if (!this.db) return;
    this.dirty = true;

    // Upsert via REPLACE (primary key covers signature+memory_id)
    this.db.prepare(
      `REPLACE INTO activity_patterns
       (context_signature, memory_id, frequency, last_accessed, avg_confidence)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      pattern.contextSignature,
      pattern.memoryId,
      pattern.frequency,
      pattern.lastAccessed,
      pattern.avgConfidence,
    );

    this.scheduleFlush();
  }

  /** Save a batch of patterns efficiently */
  saveBatch(patterns: StoredPattern[]): Result<void> {
    if (!this.db) return err(new Error('PatternStore not initialized'));
    if (patterns.length === 0) return ok(undefined);

    const insert = this.db.prepare(
      `REPLACE INTO activity_patterns
       (context_signature, memory_id, frequency, last_accessed, avg_confidence)
       VALUES (?, ?, ?, ?, ?)`
    );

    const transaction = this.db.transaction((rows: StoredPattern[]) => {
      for (const p of rows) {
        insert.run(p.contextSignature, p.memoryId, p.frequency, p.lastAccessed, p.avgConfidence);
      }
    });

    try {
      transaction(patterns);
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Delete patterns older than a given age (in ms) */
  prune(olderThanMs: number): Result<number> {
    if (!this.db) return err(new Error('PatternStore not initialized'));

    const cutoff = Date.now() - olderThanMs;
    const result = this.db
      .prepare('DELETE FROM activity_patterns WHERE last_accessed < ?')
      .run(cutoff);

    return ok(result.changes);
  }

  /** Force an immediate flush (noop for SQLite, but useful for future backends) */
  flush(): Result<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.dirty = false;
    return ok(undefined);
  }

  /** Close the database connection */
  close(): void {
    this.flush();
    this.db?.close();
    this.db = null;
  }

  /** Get pattern statistics */
  getStats(): Result<{ totalPatterns: number; uniqueContexts: number }> {
    if (!this.db) return err(new Error('PatternStore not initialized'));

    const totalRow = this.db
      .prepare('SELECT COUNT(*) as count FROM activity_patterns')
      .get() as { count: number };
    const contextRow = this.db
      .prepare('SELECT COUNT(DISTINCT context_signature) as count FROM activity_patterns')
      .get() as { count: number };

    return ok({
      totalPatterns: totalRow.count,
      uniqueContexts: contextRow.count,
    });
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (this.dirty) {
        this.dirty = false;
        // SQLite writes are synchronous; nothing more to do
      }
    }, this.flushIntervalMs);
  }
}
