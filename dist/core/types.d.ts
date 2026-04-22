/**
 * Core type definitions for Omnimind memory system
 * All types are pure data structures — no business logic
 */
/** Memory layer identifier */
export declare const MemoryLayer: {
    readonly Verbatim: 0;
    readonly Compressed: 1;
    readonly Concept: 2;
    readonly Wisdom: 3;
};
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
    readonly temporalHalfLife?: number | undefined;
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
export type EntityType = 'person' | 'project' | 'concept' | 'file' | 'api' | 'class' | 'function' | 'database' | 'service' | 'unknown';
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
export type Result<T, E = Error> = {
    readonly ok: true;
    readonly value: T;
} | {
    readonly ok: false;
    readonly error: E;
};
/** Helper to create ok result */
export declare function ok<T>(value: T): Result<T, never>;
/** Helper to create err result */
export declare function err<E>(error: E): Result<never, E>;
/** Time constants (in milliseconds) */
export declare const TimeConstants: {
    readonly DAY: number;
    readonly WEEK: number;
    readonly MONTH: number;
    readonly HALF_YEAR: number;
};
/** Aging thresholds for layer transitions */
export declare const AgingThresholds: {
    readonly 0: number;
    readonly 1: number;
    readonly 2: number;
    readonly 3: number;
};
/** Default search configuration */
export declare const DefaultSearchConfig: {
    readonly limit: 10;
    readonly boostRecent: true;
    readonly temporalHalfLife: number;
    readonly hybridAlpha: 0.7;
    readonly predictionThreshold: 0.7;
    readonly predictionMaxResults: 3;
    readonly wakeUpTokenBudget: 150;
};
//# sourceMappingURL=types.d.ts.map