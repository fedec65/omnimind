/**
 * AgingPipeline — Hierarchical memory aging system
 *
 * Transitions memories between layers over time:
 * L0 (Verbatim, 0-7d) → L1 (Compressed, 7-30d) → L2 (Concept, 30-180d) → L3 (Wisdom, 180d+)
 *
 * Key design decisions:
 * - Lazy aging: transitions happen on ACCESS, not on schedule
 * - Pinned memories are never aged
 * - Old representations are kept as backups
 * - All compression is local (zero LLM calls)
 */
import { type Memory, type MemoryLayerId, type Result } from '../core/types.js';
/** Compression rule for shorthand transformation */
interface CompressionRule {
    pattern: RegExp;
    replacement: string;
    priority: number;
}
/**
 * Hierarchical memory aging pipeline.
 *
 * Usage:
 * ```typescript
 * const pipeline = new AgingPipeline();
 *
 * // Check if a memory should be aged
 * if (pipeline.shouldAge(memory)) {
 *   const aged = await pipeline.transition(memory, targetLayer);
 *   // Store aged version, keep original as backup
 * }
 * ```
 */
export declare class AgingPipeline {
    private readonly rules;
    constructor(rules?: CompressionRule[]);
    /**
     * Check if a memory should transition to the next layer.
     *
     * Criteria:
     * - Memory is older than the layer's threshold
     * - Memory is not pinned
     * - Memory hasn't already transitioned
     */
    shouldAge(memory: Memory): boolean;
    /**
     * Get the target layer for a memory based on its age.
     */
    getTargetLayer(memory: Memory): MemoryLayerId;
    /**
     * Transition a memory to a target layer.
     *
     * Returns the transformed memory content without modifying the original.
     */
    transition(memory: Memory, targetLayer: MemoryLayerId): Promise<Result<Memory>>;
    /**
     * L0 → L1: Compress verbatim text to shorthand.
     *
     * Uses local rule-based compression (zero LLM calls).
     * Typical reduction: 60-80% of original size.
     */
    private compressToL1;
    /**
     * L1 → L2: Extract entities and relations to knowledge graph.
     *
     * Uses simple heuristics for entity extraction (zero LLM calls).
     * Stores concept references instead of full text.
     */
    private extractToL2;
    /**
     * L2 → L3: Distill patterns from concept graph.
     *
     * Creates a "wisdom" rule: a general pattern learned from specific instances.
     */
    private distillToL3;
    /** Extract entities from text using heuristic patterns */
    private extractEntities;
    /** Infer entity type from surrounding context */
    private inferEntityType;
    /** Extract recurring patterns from text */
    private extractPatterns;
    /** Get compression stats for a memory */
    getCompressionStats(original: Memory, compressed: Memory): {
        ratio: number;
        reduction: number;
    };
}
/** Time-driven aging scheduler (optional cron-like trigger) */
export declare class AgingScheduler {
    private readonly _pipeline;
    private intervalId;
    constructor(pipeline: AgingPipeline);
    /** Start periodic aging checks (default: every hour) */
    start(checkIntervalMs?: number): void;
    /** Stop the scheduler */
    stop(): void;
    /** Run a single aging check (called by scheduler or manually) */
    private runAgingCheck;
}
export {};
//# sourceMappingURL=AgingPipeline.d.ts.map