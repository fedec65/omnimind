/**
 * MemoryStore — Core memory storage engine
 *
 * Provides CRUD operations, search, and hierarchical layer management.
 * All data stored in SQLite with vector search via sqlite-vss and
 * keyword search via FTS5.
 *
 * 100% local — zero external API calls.
 */
import { type Memory, type MemoryMeta, type SearchResult, type SearchOptions, type StoreStats, type Result } from './types.js';
export interface MemoryStoreConfig {
    dbPath: string;
    modelPath?: string | undefined;
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
export declare class MemoryStore {
    private db;
    private embeddingEngine;
    private searchEngine;
    private readonly config;
    private initialized;
    private stmtInsert;
    private stmtSelectById;
    private stmtSelectByHash;
    private stmtDelete;
    private stmtUpdateAccess;
    private stmtPin;
    private stmtCountByLayer;
    private stmtCountAll;
    private stmtDbSize;
    constructor(config: MemoryStoreConfig);
    /**
     * Initialize the database and engines.
     * Must be called before any other method.
     */
    init(): Promise<Result<void>>;
    /** Store a new memory */
    store(content: string, meta: MemoryMeta): Promise<Result<Memory>>;
    /** Get a memory by ID */
    get(id: string): Promise<Result<Memory | null>>;
    /** Delete a memory by ID */
    delete(id: string): Promise<Result<void>>;
    /** Pin a memory (prevent aging) */
    pin(id: string): Promise<Result<void>>;
    /** Unpin a memory (allow aging) */
    unpin(id: string): Promise<Result<void>>;
    /**
     * Search memories using hybrid search (semantic + keyword).
     *
     * This is the primary search method — it combines vector similarity
     * with full-text keyword search and fuses the results.
     */
    search(query: string, opts?: SearchOptions): Promise<Result<SearchResult[]>>;
    /** Get store statistics */
    getStats(): Promise<Result<StoreStats>>;
    /** Close the database connection */
    close(): void;
    private prepareStatements;
    private rowToMemory;
    private buildFilter;
    private fuseResults;
    private applyTemporalBoost;
    private logActivity;
}
//# sourceMappingURL=MemoryStore.d.ts.map