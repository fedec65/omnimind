/**
 * Core type definitions for Omnimind memory system
 * All types are pure data structures — no business logic
 */

/** Memory layer identifier */
export const MemoryLayer = {
  Verbatim: 0,    // L0: Full text, 0-7 days
  Compressed: 1,  // L1: AAAK shorthand, 7-30 days
  Concept: 2,     // L2: Knowledge graph nodes, 30-180 days
  Wisdom: 3,      // L3: Distilled patterns, 180+ days
} as const;

export type MemoryLayerId = (typeof MemoryLayer)[keyof typeof MemoryLayer];

/** Core memory entity */
export interface Memory {
  readonly id: string;
  readonly content: string;
  readonly contentHash: string;
  readonly embedding: Float32Array;
  readonly layer: MemoryLayerId;
  readonly wing: string;
  readonly room: string;
  readonly sourceTool: string;
  readonly sourceId: string | null;
  readonly confidence: number;
  readonly createdAt: number;
  readonly accessedAt: number;
  readonly accessCount: number;
  readonly validFrom: number | null;
  readonly validTo: number | null;
  readonly pinned: boolean;
  readonly compressedRef: string | null;
  readonly conceptRefs: string[];
}

/** Metadata provided when storing a new memory */
export interface MemoryMeta {
  wing: string;
  room?: string | undefined;
  sourceTool?: string | undefined;
  sourceId?: string | undefined;
  confidence?: number | undefined;
  validFrom?: number | undefined;
  validTo?: number | undefined;
  pinned?: boolean | undefined;
}

/** Search result with relevance score */
export interface SearchResult {
  readonly memory: Memory;
  readonly score: number;
  readonly matchType: 'vector' | 'keyword' | 'graph' | 'hybrid';
}

/** Search options for fine-tuning retrieval */
export interface SearchOptions {
  readonly limit?: number | undefined;
  readonly layer?: MemoryLayerId | MemoryLayerId[] | undefined;
  readonly wing?: string | undefined;
  readonly room?: string | undefined;
  readonly timeRange?: readonly [number, number] | undefined;
  readonly includeExpired?: boolean | undefined;
  readonly boostRecent?: boolean | undefined;
  readonly temporalHalfLife?: number | undefined; // ms, default 7 days
}

/** Entity in the knowledge graph */
export interface Entity {
  readonly id: string;
  readonly name: string;
  readonly type: EntityType;
  readonly description: string | null;
  readonly firstSeen: number;
  readonly lastSeen: number;
  readonly mentionCount: number;
}

/** Supported entity types */
export type EntityType =
  | 'person'
  | 'project'
  | 'concept'
  | 'file'
  | 'api'
  | 'class'
  | 'function'
  | 'database'
  | 'service'
  | 'unknown';

/** Relation between two entities */
export interface Relation {
  readonly id: string;
  readonly subjectId: string;
  readonly predicate: string;
  readonly objectId: string;
  readonly validFrom: number | null;
  readonly validTo: number | null;
  readonly sourceMemory: string | null;
  readonly confidence: number;
}

/** Result from graph traversal */
export interface GraphResult {
  readonly memory: Memory;
  readonly path: readonly Relation[];
  readonly depth: number;
}

/** Store statistics */
export interface StoreStats {
  readonly totalMemories: number;
  readonly memoriesByLayer: Record<MemoryLayerId, number>;
  readonly totalEntities: number;
  readonly totalRelations: number;
  readonly databaseSizeBytes: number;
  readonly avgRetrievalLatencyMs: number;
}

/** Compression rule for L0 → L1 transition */
export interface CompressionRule {
  readonly pattern: RegExp;
  readonly template: string | ((match: string) => string);
  readonly priority: number;
}

/** Predicted memory with confidence score */
export interface PredictedMemory extends Memory {
  readonly predictionConfidence: number;
}

/** Context fingerprint for prediction */
export interface ContextFingerprint {
  readonly projectHash: string;
  readonly branchHash: string;
  readonly fileExtension: string;
  readonly timeOfDay: number;
  readonly dayOfWeek: number;
  readonly recentTools: readonly string[];
  readonly recentWings: readonly string[];
  readonly recentRooms: readonly string[];
}

/** Memory event for cross-tool sync */
export interface MemoryEvent {
  readonly id: string;
  readonly timestamp: number;
  readonly sourceTool: string;
  readonly eventType: 'create' | 'update' | 'delete' | 'access';
  readonly memoryId: string | null;
  readonly payload: {
    readonly content?: string;
    readonly wing?: string;
    readonly room?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  };
  readonly vectorClock: Readonly<Record<string, number>>;
}

/** Result type for operations that can fail */
export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Helper to create ok result */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Helper to create err result */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Time constants (in milliseconds) */
export const TimeConstants = {
  DAY: 24 * 60 * 60 * 1000,
  WEEK: 7 * 24 * 60 * 60 * 1000,
  MONTH: 30 * 24 * 60 * 60 * 1000,
  HALF_YEAR: 180 * 24 * 60 * 60 * 1000,
} as const;

/** Aging thresholds for layer transitions */
export const AgingThresholds = {
  [MemoryLayer.Verbatim]: TimeConstants.WEEK,     // 7 days → compress
  [MemoryLayer.Compressed]: TimeConstants.MONTH,   // 30 days → concept
  [MemoryLayer.Concept]: TimeConstants.HALF_YEAR,  // 180 days → wisdom
  [MemoryLayer.Wisdom]: Infinity,                  // Terminal layer
} as const;

/** Default search configuration */
export const DefaultSearchConfig = {
  limit: 10,
  boostRecent: true,
  temporalHalfLife: TimeConstants.WEEK,
  hybridAlpha: 0.7, // 70% vector, 30% keyword
  predictionThreshold: 0.7,
  predictionMaxResults: 3,
  wakeUpTokenBudget: 150,
} as const;
