/**
 * Omnimind — Proactive, cross-tool memory system for LLMs
 *
 * Main entry point and public API.
 *
 * Usage:
 * ```typescript
 * import { Omnimind } from 'omnimind';
 *
 * const omni = await Omnimind.create();
 *
 * // Store a memory
 * await omni.store("User prefers GraphQL over REST", {
 *   wing: "project-alpha",
 *   room: "architecture",
 * });
 *
 * // Search memories
 * const results = await omni.search("GraphQL API decision");
 *
 * // Get predictions
 * const predictions = await omni.predict({
 *   projectPath: "/home/user/projects/alpha",
 *   gitBranch: "feature/auth",
 *   currentFile: "src/api.ts",
 * });
 *
 * // Format for context injection
 * const context = await omni.formatPredictions(predictions);
 * // → "<omnimind_predictions confidence="0.85">...</omnimind_predictions>"
 * ```
 */
import { MemoryStore } from './core/MemoryStore.js';
import { EmbeddingEngine } from './core/EmbeddingEngine.js';
import { SearchEngine } from './core/SearchEngine.js';
import { AgingPipeline } from './layers/AgingPipeline.js';
import { IntentPredictor, buildFingerprint } from './prediction/IntentPredictor.js';
import { type Memory, type MemoryMeta, type SearchResult, type SearchOptions, type ContextFingerprint, type PredictedMemory, type StoreStats, type Result, MemoryLayer } from './core/types.js';
import { type Prediction } from './prediction/IntentPredictor.js';
export interface OmnimindConfig {
    dataDir?: string | undefined;
    dbName?: string | undefined;
    modelPath?: string | undefined;
}
/**
 * Omnimind — Unified memory system API.
 *
 * This is the primary interface for all memory operations.
 * It composes the store, search, prediction, and aging subsystems.
 */
export declare class Omnimind {
    readonly memoryStore: MemoryStore;
    readonly predictor: IntentPredictor;
    readonly aging: AgingPipeline;
    private constructor();
    /**
     * Create and initialize an Omnimind instance.
     *
     * This sets up the database, downloads models if needed,
     * and prepares all subsystems.
     */
    static create(config?: OmnimindConfig): Promise<Omnimind>;
    /** Store a new memory */
    store(content: string, meta: MemoryMeta): Promise<Result<Memory>>;
    /** Search memories with hybrid search */
    search(query: string, opts?: SearchOptions): Promise<Result<SearchResult[]>>;
    /** Get a memory by ID */
    get(id: string): Promise<Result<Memory | null>>;
    /** Delete a memory */
    delete(id: string): Promise<Result<void>>;
    /** Pin a memory (prevent aging) */
    pin(id: string): Promise<Result<void>>;
    /** Unpin a memory (allow aging) */
    unpin(id: string): Promise<Result<void>>;
    /**
     * Predict relevant memories for the current context.
     *
     * Returns predictions sorted by confidence.
     * Only returns predictions with confidence >= 70%.
     */
    predict(context: {
        projectPath: string;
        gitBranch: string;
        currentFile: string;
        recentTools: string[];
        recentWings?: string[];
        recentRooms?: string[];
    }): Promise<Result<Prediction[]>>;
    /**
     * Format predictions as compact XML for context injection.
     *
     * Target size: < 150 tokens.
     * Format: <omnimind_predictions confidence="0.85">...</omnimind_predictions>
     */
    formatPredictions(predictions: Prediction[]): Promise<string>;
    /**
     * Check if a memory should be aged and perform the transition.
     *
     * This is called lazily — typically when a memory is accessed.
     */
    checkAging(memoryId: string): Promise<Result<Memory>>;
    /** Get system statistics */
    stats(): Promise<Result<StoreStats>>;
    /** Close all resources */
    close(): void;
}
export { MemoryLayer, buildFingerprint, EmbeddingEngine, SearchEngine, AgingPipeline, IntentPredictor, };
export type { Memory, MemoryMeta, SearchResult, SearchOptions, ContextFingerprint, PredictedMemory, StoreStats, Result, Prediction, };
//# sourceMappingURL=index.d.ts.map