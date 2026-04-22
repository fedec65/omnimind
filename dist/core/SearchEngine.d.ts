/**
 * SearchEngine — Hybrid search combining vector similarity + keyword search
 *
 * Uses sqlite-vss for vector search and FTS5 for keyword search.
 * Falls back to brute-force cosine similarity if vss is unavailable.
 *
 * All operations are local — zero external dependencies.
 */
import type Database from 'better-sqlite3';
import { type SearchResult } from './types.js';
import type { EmbeddingEngine } from './EmbeddingEngine.js';
export interface SearchEngineConfig {
    useVss?: boolean;
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
export declare class SearchEngine {
    private readonly db;
    private readonly useVss;
    private vssAvailable;
    constructor(db: Database.Database, _embedding: EmbeddingEngine, config?: SearchEngineConfig);
    /**
     * Semantic vector search using cosine similarity.
     * Returns memories ordered by embedding similarity.
     */
    vectorSearch(queryEmbedding: Float32Array, limit: number, whereClause?: string, params?: unknown[]): Promise<SearchResult[]>;
    /**
     * Keyword search using FTS5.
     * Returns memories ordered by text relevance.
     */
    keywordSearch(query: string, limit: number, whereClause?: string, params?: unknown[]): Promise<SearchResult[]>;
    /** Insert a vector into the VSS index */
    indexVector(memoryId: string, embedding: Float32Array): Promise<void>;
    private vssSearch;
    private fallbackVectorSearch;
    private getEmbeddingForMemory;
    private cosineSimilarity;
    private rowToMemory;
}
//# sourceMappingURL=SearchEngine.d.ts.map