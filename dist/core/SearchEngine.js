/**
 * SearchEngine — Hybrid search combining vector similarity + keyword search
 *
 * Uses sqlite-vss for vector search and FTS5 for keyword search.
 * Falls back to brute-force cosine similarity if vss is unavailable.
 *
 * All operations are local — zero external dependencies.
 */
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
    db;
    useVss;
    vssAvailable = false;
    constructor(db, _embedding, config = {}) {
        this.db = db;
        this.useVss = config.useVss ?? true;
        // Check if VSS is available
        try {
            this.db.prepare("SELECT vss_version()").get();
            this.vssAvailable = true;
        }
        catch {
            this.vssAvailable = false;
            console.warn('[SearchEngine] sqlite-vss not available — using fallback search');
        }
    }
    /**
     * Semantic vector search using cosine similarity.
     * Returns memories ordered by embedding similarity.
     */
    async vectorSearch(queryEmbedding, limit, whereClause = '', params = []) {
        if (this.vssAvailable && this.useVss) {
            return this.vssSearch(queryEmbedding, limit, whereClause, params);
        }
        return this.fallbackVectorSearch(queryEmbedding, limit, whereClause, params);
    }
    /**
     * Keyword search using FTS5.
     * Returns memories ordered by text relevance.
     */
    async keywordSearch(query, limit, whereClause = '', params = []) {
        try {
            // Clean query for FTS5 (remove special characters)
            const cleanQuery = query
                .replace(/[^\w\s]/g, ' ')
                .split(/\s+/)
                .filter(t => t.length > 1)
                .map(t => `${t}*`)
                .join(' ');
            if (!cleanQuery.trim())
                return [];
            const sql = `
        SELECT m.*, rank as fts_score
        FROM memories m
        JOIN memories_fts fts ON m.rowid = fts.rowid
        ${whereClause}
        ${whereClause ? 'AND' : 'WHERE'} memories_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `;
            const rows = this.db.prepare(sql).all(...params, cleanQuery, limit);
            return rows.map(row => ({
                memory: this.rowToMemory(row),
                score: Math.abs(row.fts_score), // FTS5 rank is negative (lower = better)
                matchType: 'keyword',
            }));
        }
        catch {
            // FTS might not be set up — return empty
            return [];
        }
    }
    /** Insert a vector into the VSS index */
    async indexVector(memoryId, embedding) {
        if (!this.vssAvailable)
            return;
        try {
            // Convert Float32Array to buffer for storage
            const buffer = Buffer.from(embedding.buffer);
            this.db.prepare('INSERT INTO vss_memories(rowid, embedding) VALUES ((SELECT rowid FROM memories WHERE id = ?), ?)').run(memoryId, buffer);
        }
        catch {
            // VSS insert failed — non-critical
        }
    }
    // ─── Private: VSS search ─────────────────────────────────────────
    async vssSearch(queryEmbedding, limit, whereClause, params) {
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
            const rows = this.db.prepare(sql).all(...params, buffer, limit);
            return rows.map(row => ({
                memory: this.rowToMemory(row),
                score: 1 / (1 + row.distance), // Convert distance to similarity
                matchType: 'vector',
            }));
        }
        catch {
            // VSS query failed — fall back
            return this.fallbackVectorSearch(queryEmbedding, limit, whereClause, params);
        }
    }
    // ─── Private: Fallback brute-force search ────────────────────────
    async fallbackVectorSearch(queryEmbedding, limit, whereClause, params) {
        // Get candidate memories (filter first)
        const sql = `SELECT * FROM memories ${whereClause} LIMIT 1000`;
        const rows = this.db.prepare(sql).all(...params);
        if (rows.length === 0)
            return [];
        // Compute cosine similarity for each
        const scored = rows.map(row => {
            // Get embedding from memory (stored as BLOB)
            const embedding = this.getEmbeddingForMemory(row.id);
            if (!embedding)
                return null;
            const similarity = this.cosineSimilarity(queryEmbedding, embedding);
            return {
                memory: this.rowToMemory(row),
                score: similarity,
                matchType: 'vector',
            };
        });
        // Sort and take top-k
        return scored
            .filter((r) => r !== null)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }
    getEmbeddingForMemory(memoryId) {
        try {
            const row = this.db
                .prepare('SELECT embedding FROM memories WHERE id = ?')
                .get(memoryId);
            if (!row?.embedding)
                return null;
            return new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4);
        }
        catch {
            return null;
        }
    }
    cosineSimilarity(a, b) {
        let dot = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
    }
    rowToMemory(row) {
        return {
            id: row.id,
            content: row.content,
            contentHash: row.content_hash,
            embedding: new Float32Array(0), // Lazy loaded
            layer: row.layer,
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
//# sourceMappingURL=SearchEngine.js.map