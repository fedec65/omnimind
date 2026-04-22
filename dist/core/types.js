/**
 * Core type definitions for Omnimind memory system
 * All types are pure data structures — no business logic
 */
/** Memory layer identifier */
export const MemoryLayer = {
    Verbatim: 0, // L0: Full text, 0-7 days
    Compressed: 1, // L1: AAAK shorthand, 7-30 days
    Concept: 2, // L2: Knowledge graph nodes, 30-180 days
    Wisdom: 3, // L3: Distilled patterns, 180+ days
};
/** Helper to create ok result */
export function ok(value) {
    return { ok: true, value };
}
/** Helper to create err result */
export function err(error) {
    return { ok: false, error };
}
/** Time constants (in milliseconds) */
export const TimeConstants = {
    DAY: 24 * 60 * 60 * 1000,
    WEEK: 7 * 24 * 60 * 60 * 1000,
    MONTH: 30 * 24 * 60 * 60 * 1000,
    HALF_YEAR: 180 * 24 * 60 * 60 * 1000,
};
/** Aging thresholds for layer transitions */
export const AgingThresholds = {
    [MemoryLayer.Verbatim]: TimeConstants.WEEK, // 7 days → compress
    [MemoryLayer.Compressed]: TimeConstants.MONTH, // 30 days → concept
    [MemoryLayer.Concept]: TimeConstants.HALF_YEAR, // 180 days → wisdom
    [MemoryLayer.Wisdom]: Infinity, // Terminal layer
};
/** Default search configuration */
export const DefaultSearchConfig = {
    limit: 10,
    boostRecent: true,
    temporalHalfLife: TimeConstants.WEEK,
    hybridAlpha: 0.7, // 70% vector, 30% keyword
    predictionThreshold: 0.7,
    predictionMaxResults: 3,
    wakeUpTokenBudget: 150,
};
//# sourceMappingURL=types.js.map