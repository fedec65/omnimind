/**
 * IntentPredictor — Lightweight activity-based memory prediction
 *
 * Predicts which memories a user will need based on their current activity context.
 * Uses local heuristics + simple pattern matching — zero LLM calls.
 *
 * Key constraints:
 * - Prediction must complete in < 5ms
 * - Only predict when confidence >= 70%
 * - Maximum 3 predictions per trigger
 * - Never block user interaction
 */
import { type ContextFingerprint, type Memory, type Result } from '../core/types.js';
/** A single prediction with confidence score */
export interface Prediction {
    readonly memoryId: string;
    readonly confidence: number;
    readonly reason: string;
}
export interface IntentPredictorConfig {
    confidenceThreshold?: number;
    maxPredictions?: number;
    patternWindowDays?: number;
    minFrequency?: number;
}
/**
 * Intent predictor for proactive memory retrieval.
 *
 * Usage:
 * ```typescript
 * const predictor = new IntentPredictor();
 *
 * // Build fingerprint from current activity
 * const fingerprint = buildFingerprint({
 *   projectPath: process.cwd(),
 *   gitBranch: 'feature/auth',
 *   fileExtension: '.ts',
 *   recentTools: ['claude-code'],
 *   recentWings: ['project-alpha'],
 * });
 *
 * // Get predictions
 * const predictions = await predictor.predict(fingerprint);
 * if (predictions.ok && predictions.value.length > 0) {
 *   // Inject into context
 * }
 * ```
 */
export declare class IntentPredictor {
    private readonly config;
    private patterns;
    constructor(config?: IntentPredictorConfig);
    /**
     * Record an activity event for pattern learning.
     *
     * Call this whenever a memory is accessed or created.
     */
    recordAccess(fingerprint: ContextFingerprint, memoryId: string): void;
    /**
     * Predict relevant memories for the current context.
     *
     * Algorithm:
     * 1. Build context signature from fingerprint
     * 2. Find similar historical signatures
     * 3. Score memories by frequency + recency
     * 4. Filter by confidence threshold
     * 5. Return top-N predictions
     */
    predict(fingerprint: ContextFingerprint, _memoryFetcher: (id: string) => Promise<Memory | null>): Promise<Result<Prediction[]>>;
    /**
     * Format predictions as compact context string for injection.
     *
     * Target: < 150 tokens total.
     */
    formatPredictions(predictions: Prediction[], memoryFetcher: (id: string) => Promise<Memory | null>): Promise<string>;
    private formatPredictionsImpl;
    /** Get pattern statistics for debugging */
    getStats(): {
        totalPatterns: number;
        uniqueContexts: number;
    };
    /**
     * Build a compact signature from a context fingerprint.
     *
     * This is a lossy compression of context for fast lookup.
     * We intentionally drop some detail to enable fuzzy matching.
     */
    private buildSignature;
    /**
     * Find candidate patterns matching the current context.
     *
     * Strategy:
     * 1. Try exact signature match
     * 2. Fall back to partial matches (same project, same wing)
     * 3. Apply time window filter
     */
    private findCandidatePatterns;
    /**
     * Compute confidence score for a pattern.
     *
     * Formula: combines frequency, recency, and base confidence.
     */
    private computeConfidence;
    /** Build human-readable reason for a prediction */
    private buildReason;
}
/**
 * Build a context fingerprint from current environment.
 *
 * This is the entry point — call this whenever you want to predict
 * what memories the user might need.
 */
export declare function buildFingerprint(params: {
    projectPath: string;
    gitBranch: string;
    currentFile: string;
    recentTools: string[];
    recentWings: string[];
    recentRooms: string[];
}): ContextFingerprint;
//# sourceMappingURL=IntentPredictor.d.ts.map