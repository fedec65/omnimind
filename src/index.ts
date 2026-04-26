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

import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync } from 'fs';

import { MemoryStore } from './core/MemoryStore.js';
import { EmbeddingEngine } from './core/EmbeddingEngine.js';
import { SearchEngine } from './core/SearchEngine.js';
import { AgingPipeline } from './layers/AgingPipeline.js';
import { IntentPredictor, buildFingerprint } from './prediction/IntentPredictor.js';
import { PatternStore } from './prediction/PatternStore.js';
import { ActivityTracker } from './prediction/ActivityTracker.js';
import { ContextInjector } from './prediction/ContextInjector.js';
import { MemoryBus } from './bus/MemoryBus.js';
import { ClaudeAdapter } from './bus/adapters/ClaudeAdapter.js';
import { type MemoryEvent, type ConflictResolution, type SubscribeInput, type SyncInput } from './bus/types.js';

import {
  type Memory,
  type MemoryMeta,
  type SearchResult,
  type SearchOptions,
  type ContextFingerprint,
  type PredictedMemory,
  type StoreStats,
  type Result,
  MemoryLayer,
  ok,
  err,
} from './core/types.js';
import { type Prediction } from './prediction/IntentPredictor.js';

// ─── Configuration ────────────────────────────────────────────────

export interface OmnimindConfig {
  dataDir?: string | undefined;
  dbName?: string | undefined;
  modelPath?: string | undefined;
}

// ─── Main API ─────────────────────────────────────────────────────

/**
 * Omnimind — Unified memory system API.
 * 
 * This is the primary interface for all memory operations.
 * It composes the store, search, prediction, and aging subsystems.
 */
export class Omnimind {
  readonly memoryStore: MemoryStore;
  readonly predictor: IntentPredictor;
  readonly aging: AgingPipeline;
  readonly bus: MemoryBus;
  readonly activityTracker: ActivityTracker;
  readonly contextInjector: ContextInjector;
  private readonly patternStore: PatternStore;

  private constructor(
    store: MemoryStore,
    bus: MemoryBus,
    predictor: IntentPredictor,
    patternStore: PatternStore,
    activityTracker: ActivityTracker,
    contextInjector: ContextInjector,
  ) {
    this.memoryStore = store;
    this.predictor = predictor;
    this.aging = new AgingPipeline();
    this.bus = bus;
    this.patternStore = patternStore;
    this.activityTracker = activityTracker;
    this.contextInjector = contextInjector;
  }

  /**
   * Create and initialize an Omnimind instance.
   * 
   * This sets up the database, downloads models if needed,
   * and prepares all subsystems.
   */
  static async create(config: OmnimindConfig = {}): Promise<Omnimind> {
    const dataDir = config.dataDir ?? join(homedir(), '.omnimind');
    const dbPath = join(dataDir, config.dbName ?? 'memory.db');

    // Ensure data directory exists
    mkdirSync(dataDir, { recursive: true });

    // Initialize store
    const store = new MemoryStore({ dbPath, modelPath: config.modelPath });
    const result = await store.init();
    if (!result.ok) {
      throw new Error(`Failed to initialize Omnimind: ${result.error.message}`);
    }

    // Initialize prediction with persistence
    const predictor = new IntentPredictor();
    const patternDbPath = join(dataDir, 'patterns.db');
    const patternStore = new PatternStore({ dbPath: patternDbPath });
    predictor.attachStore(patternStore);

    // Initialize cross-tool memory bus
    const bus = new MemoryBus(store);
    const claudeAdapter = new ClaudeAdapter(bus);
    const adapterResult = await bus.registerAdapter(claudeAdapter);
    if (!adapterResult.ok) {
      console.error(`[Omnimind] Claude adapter failed: ${adapterResult.error.message}`);
    }

    // Initialize activity tracking and context injection
    const activityTracker = new ActivityTracker(predictor, bus, { watchDir: process.cwd() });
    const activityStart = activityTracker.start();
    if (!activityStart.ok) {
      console.error(`[Omnimind] Activity tracker failed: ${activityStart.error.message}`);
    }

    const contextInjector = new ContextInjector(predictor, async (id) => {
      const r = await store.get(id);
      return r.ok ? r.value : null;
    });

    const omni = new Omnimind(store, bus, predictor, patternStore, activityTracker, contextInjector);
    console.log(`[Omnimind] Initialized at ${dbPath}`);
    return omni;
  }

  // ─── Core Operations ────────────────────────────────────────────

  /** Store a new memory */
  async store(content: string, meta: MemoryMeta): Promise<Result<Memory>> {
    const result = await this.memoryStore.store(content, meta);
    if (result.ok) {
      // Update predictor with this access
      // (In real implementation, we'd track the context that led to storage)
    }
    return result;
  }

  /** Search memories with hybrid search */
  async search(query: string, opts?: SearchOptions): Promise<Result<SearchResult[]>> {
    return this.memoryStore.search(query, opts);
  }

  /** Get a memory by ID */
  async get(id: string): Promise<Result<Memory | null>> {
    return this.memoryStore.get(id);
  }

  /** Delete a memory */
  async delete(id: string): Promise<Result<void>> {
    return this.memoryStore.delete(id);
  }

  /** Pin a memory (prevent aging) */
  async pin(id: string): Promise<Result<void>> {
    return this.memoryStore.pin(id);
  }

  /** Unpin a memory (allow aging) */
  async unpin(id: string): Promise<Result<void>> {
    return this.memoryStore.unpin(id);
  }

  // ─── Prediction ─────────────────────────────────────────────────

  /**
   * Predict relevant memories for the current context.
   * 
   * Returns predictions sorted by confidence.
   * Only returns predictions with confidence >= 70%.
   */
  async predict(context: {
    projectPath: string;
    gitBranch: string;
    currentFile: string;
    recentTools: string[];
    recentWings?: string[];
    recentRooms?: string[];
  }): Promise<Result<Prediction[]>> {
    const fingerprint = buildFingerprint({
      projectPath: context.projectPath,
      gitBranch: context.gitBranch,
      currentFile: context.currentFile,
      recentTools: context.recentTools,
      recentWings: context.recentWings ?? [],
      recentRooms: context.recentRooms ?? [],
    });

    return this.predictor.predict(fingerprint, async (id) => {
      const result = await this.memoryStore.get(id);
      return result.ok ? result.value : null;
    });
  }

  /**
   * Format predictions as compact XML for context injection.
   * 
   * Target size: < 150 tokens.
   * Format: <omnimind_predictions confidence="0.85">...</omnimind_predictions>
   */
  async formatPredictions(predictions: Prediction[]): Promise<string> {
    if (predictions.length === 0) return '';

    const lines: string[] = [];
    let tokenEstimate = 0;

    for (const pred of predictions.slice(0, 3)) {
      if (tokenEstimate > 150) break;

      const mem = await this.memoryStore.get(pred.memoryId);
      if (!mem.ok || !mem.value) continue;

      const line = `[${mem.value.wing}] ${mem.value.content.substring(0, 200)}`;
      lines.push(line);
      tokenEstimate += line.split(/\s+/).length;
    }

    if (lines.length === 0) return '';

    const avgConfidence = predictions.reduce((s, p) => s + p.confidence, 0) / predictions.length;
    return `\n<omnimind_predictions confidence="${avgConfidence.toFixed(2)}">\n${lines.join('\n')}\n</omnimind_predictions>\n`;
  }

  // ─── Aging ──────────────────────────────────────────────────────

  /**
   * Check if a memory should be aged and perform the transition.
   * 
   * This is called lazily — typically when a memory is accessed.
   */
  async checkAging(memoryId: string): Promise<Result<Memory>> {
    const getResult = await this.memoryStore.get(memoryId);
    if (!getResult.ok) return err(getResult.error);
    if (!getResult.value) return err(new Error(`Memory not found: ${memoryId}`));

    const memory = getResult.value;

    if (!this.aging.shouldAge(memory)) {
      return ok(memory);
    }

    const targetLayer = this.aging.getTargetLayer(memory);
    if (targetLayer === memory.layer) {
      return ok(memory);
    }

    const transition = await this.aging.transition(memory, targetLayer);
    if (!transition.ok) return err(transition.error);

    // In a real implementation, we'd update the store with the aged version
    // while keeping the original as a reference
    console.log(`[Omnimind] Aged memory ${memoryId.substring(0, 8)}: L${memory.layer} → L${targetLayer}`);

    return ok(transition.value);
  }

  // ─── Stats ──────────────────────────────────────────────────────

  /** Get system statistics */
  async stats(): Promise<Result<StoreStats>> {
    return this.memoryStore.getStats();
  }

  // ─── Bus Operations ─────────────────────────────────────────────

  /** Subscribe to memory updates from specific wings or rooms */
  subscribe(toolId: string, input: SubscribeInput): Result<void> {
    try {
      const filter: import('./bus/types.js').BusSubscription['filter'] = {};
      if (input.wings !== undefined) (filter as Record<string, unknown>).wings = input.wings;
      if (input.eventTypes !== undefined) (filter as Record<string, unknown>).eventTypes = input.eventTypes;
      this.bus.subscribe(toolId, filter);
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Sync missed events from other tools */
  async sync(toolId: string, input?: SyncInput): Promise<Result<MemoryEvent[]>> {
    return this.bus.sync(toolId, input?.since);
  }

  /** Get unresolved conflict report */
  getConflictReport(): Result<ConflictResolution[]> {
    // For now, return empty — full conflict tracking would require persistence
    return ok([]);
  }

  /**
   * Get automatic context injection for the current activity.
   *
   * Uses the ActivityTracker's current fingerprint to predict
   * and format relevant memories.
   */
  async getContextInjection(): Promise<Result<string>> {
    const fingerprint = this.activityTracker.getCurrentFingerprint();
    const injection = await this.contextInjector.inject(fingerprint);
    if (!injection.ok) return err(injection.error);
    return ok(injection.value.text);
  }

  /** Get activity tracker stats for debugging */
  getActivityStats(): { isRunning: boolean; recentFiles: number; recentTools: number } {
    return this.activityTracker.getStats();
  }

  /** Close all resources */
  close(): void {
    this.activityTracker.stop();
    this.patternStore.close();
    this.memoryStore.close();
  }
}

// ─── Convenience Exports ──────────────────────────────────────────

export {
  MemoryLayer,
  buildFingerprint,
  EmbeddingEngine,
  SearchEngine,
  AgingPipeline,
  IntentPredictor,
};

export type {
  Memory,
  MemoryMeta,
  SearchResult,
  SearchOptions,
  ContextFingerprint,
  PredictedMemory,
  StoreStats,
  Result,
  Prediction,
};
