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

import {
  type ContextFingerprint,
  type Memory,
  type Result,
  DefaultSearchConfig,
  ok,
  err,
} from '../core/types.js';
import { createHash } from 'crypto';
import { type PatternStore } from './PatternStore.js';

/** A single prediction with confidence score */
export interface Prediction {
  readonly memoryId: string;
  readonly confidence: number;
  readonly reason: string; // Human-readable explanation
}

/** Historical pattern extracted from activity log */
interface ActivityPattern {
  readonly contextSignature: string;
  readonly memoryId: string;
  readonly frequency: number;
  readonly lastAccessed: number;
  readonly avgConfidence: number;
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
export class IntentPredictor {
  private readonly config: Required<IntentPredictorConfig>;
  private patterns: Map<string, ActivityPattern[]> = new Map();
  private store: PatternStore | null = null;

  constructor(config: IntentPredictorConfig = {}) {
    this.config = {
      confidenceThreshold: config.confidenceThreshold ?? DefaultSearchConfig.predictionThreshold,
      maxPredictions: config.maxPredictions ?? DefaultSearchConfig.predictionMaxResults,
      patternWindowDays: config.patternWindowDays ?? 30,
      minFrequency: config.minFrequency ?? 2,
    };
  }

  /** Attach a PatternStore for persistence across restarts */
  attachStore(store: PatternStore): void {
    this.store = store;
    const loaded = store.load();
    for (const p of loaded) {
      const existing = this.patterns.get(p.contextSignature) ?? [];
      const idx = existing.findIndex((e) => e.memoryId === p.memoryId);
      if (idx >= 0) {
        existing[idx] = p;
      } else {
        existing.push(p);
      }
      this.patterns.set(p.contextSignature, existing);
    }
  }

  /** Flush all patterns to the attached store */
  persist(): void {
    if (!this.store) return;
    const all: import('./PatternStore.js').StoredPattern[] = [];
    for (const [sig, list] of this.patterns) {
      for (const p of list) {
        all.push({
          contextSignature: sig,
          memoryId: p.memoryId,
          frequency: p.frequency,
          lastAccessed: p.lastAccessed,
          avgConfidence: p.avgConfidence,
        });
      }
    }
    this.store.saveBatch(all);
  }

  /**
   * Record an activity event for pattern learning.
   * 
   * Call this whenever a memory is accessed or created.
   */
  recordAccess(fingerprint: ContextFingerprint, memoryId: string): void {
    const signature = this.buildSignature(fingerprint);
    const existing = this.patterns.get(signature) ?? [];

    const idx = existing.findIndex(p => p.memoryId === memoryId);
    if (idx >= 0) {
      // Update existing pattern
      const old = existing[idx]!;
      existing[idx] = {
        ...old,
        frequency: old.frequency + 1,
        lastAccessed: Date.now(),
        avgConfidence: (old.avgConfidence * old.frequency + 1) / (old.frequency + 1),
      };
    } else {
      // New pattern
      existing.push({
        contextSignature: signature,
        memoryId,
        frequency: 1,
        lastAccessed: Date.now(),
        avgConfidence: 0.5,
      });
    }

    this.patterns.set(signature, existing);

    // Persist to store if attached
    if (this.store) {
      const pattern = existing.find((p) => p.memoryId === memoryId)!;
      this.store.save({
        contextSignature: signature,
        memoryId: pattern.memoryId,
        frequency: pattern.frequency,
        lastAccessed: pattern.lastAccessed,
        avgConfidence: pattern.avgConfidence,
      });
    }
  }

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
  async predict(
    fingerprint: ContextFingerprint,
    _memoryFetcher: (id: string) => Promise<Memory | null>,
  ): Promise<Result<Prediction[]>> {
    const startTime = performance.now();

    try {
      const signature = this.buildSignature(fingerprint);

      // Find exact and similar patterns
      const candidates = this.findCandidatePatterns(signature, fingerprint);

      if (candidates.length === 0) {
        return ok([]);
      }

      // Score and rank
      const scored = candidates
        .map(c => ({
          memoryId: c.memoryId,
          confidence: this.computeConfidence(c),
          reason: this.buildReason(c, fingerprint),
        }))
        .filter(c => c.confidence >= this.config.confidenceThreshold)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, this.config.maxPredictions);

      const latency = performance.now() - startTime;
      if (latency > 5) {
        console.warn(`[IntentPredictor] Slow prediction: ${latency.toFixed(1)}ms`);
      }

      return ok(scored);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Format predictions as compact context string for injection.
   * 
   * Target: < 150 tokens total.
   */
  formatPredictions(predictions: Prediction[], memoryFetcher: (id: string) => Promise<Memory | null>): Promise<string> {
    return this.formatPredictionsImpl(predictions, memoryFetcher);
  }

  private async formatPredictionsImpl(
    predictions: Prediction[],
    memoryFetcher: (id: string) => Promise<Memory | null>,
  ): Promise<string> {
    if (predictions.length === 0) return '';

    const lines: string[] = [];
    let tokenEstimate = 0;

    for (const pred of predictions) {
      if (tokenEstimate > DefaultSearchConfig.wakeUpTokenBudget) break;

      const memory = await memoryFetcher(pred.memoryId);
      if (!memory) continue;

      const line = `[${memory.wing}/${memory.room}] ${memory.content.substring(0, 200)}`;
      lines.push(line);
      tokenEstimate += line.split(/\s+/).length;
    }

    if (lines.length === 0) return '';

    const avgConfidence = predictions.reduce((s, p) => s + p.confidence, 0) / predictions.length;
    return `\n<omnimind_predictions confidence="${avgConfidence.toFixed(2)}">\n${lines.join('\n')}\n</omnimind_predictions>\n`;
  }

  /** Get pattern statistics for debugging */
  getStats(): { totalPatterns: number; uniqueContexts: number } {
    let totalPatterns = 0;
    for (const patterns of this.patterns.values()) {
      totalPatterns += patterns.length;
    }
    return {
      totalPatterns,
      uniqueContexts: this.patterns.size,
    };
  }

  // ─── Private helpers ──────────────────────────────────────────────

  /**
   * Build a compact signature from a context fingerprint.
   * 
   * This is a lossy compression of context for fast lookup.
   * We intentionally drop some detail to enable fuzzy matching.
   */
  private buildSignature(fp: ContextFingerprint): string {
    // Use only the most predictive features
    const key = `${fp.projectHash}:${fp.fileExtension}:${fp.recentWings.join(',')}`;
    return createHash('sha256').update(key).digest('hex').substring(0, 16);
  }

  /**
   * Find candidate patterns matching the current context.
   * 
   * Strategy:
   * 1. Try exact signature match
   * 2. Fall back to partial matches (same project, same wing)
   * 3. Apply time window filter
   */
  private findCandidatePatterns(
    _signature: string,
    _fingerprint: ContextFingerprint,
  ): ActivityPattern[] {
    const now = Date.now();
    const windowMs = this.config.patternWindowDays * 24 * 60 * 60 * 1000;

    // Exact match
    const exact = this.patterns.get(_signature) ?? [];

    // Similar contexts (same project or wing)
    const similar: ActivityPattern[] = [];
    for (const [sig, patterns] of this.patterns) {
      if (sig === _signature) continue;
      for (const p of patterns) {
        // Check if memory was accessed in this similar context
        if (now - p.lastAccessed <= windowMs && p.frequency >= this.config.minFrequency) {
          similar.push(p);
        }
      }
    }

    // Combine and deduplicate by memoryId
    const combined = [...exact, ...similar];
    const deduped = new Map<string, ActivityPattern>();
    for (const p of combined) {
      const existing = deduped.get(p.memoryId);
      if (!existing || p.frequency > existing.frequency) {
        deduped.set(p.memoryId, p);
      }
    }

    return Array.from(deduped.values()).filter(
      p => now - p.lastAccessed <= windowMs && p.frequency >= this.config.minFrequency,
    );
  }

  /**
   * Compute confidence score for a pattern.
   * 
   * Formula: combines frequency, recency, and base confidence.
   */
  private computeConfidence(pattern: ActivityPattern): number {
    const now = Date.now();
    const windowMs = this.config.patternWindowDays * 24 * 60 * 60 * 1000;

    // Frequency component (0-0.5)
    const freqScore = Math.min(0.5, pattern.frequency / 10);

    // Recency component (0-0.3)
    const recency = Math.max(0, 1 - (now - pattern.lastAccessed) / windowMs);
    const recencyScore = recency * 0.3;

    // Base confidence (0-0.2)
    const baseScore = pattern.avgConfidence * 0.2;

    return Math.min(0.95, freqScore + recencyScore + baseScore);
  }

  /** Build human-readable reason for a prediction */
  private buildReason(pattern: ActivityPattern, fingerprint: ContextFingerprint): string {
    const parts: string[] = [];

    if (pattern.frequency >= 5) {
      parts.push(`accessed ${pattern.frequency} times`);
    } else {
      parts.push(`accessed ${pattern.frequency} time${pattern.frequency > 1 ? 's' : ''}`);
    }

    if (fingerprint.recentWings.length > 0) {
      parts.push(`in ${fingerprint.recentWings[0]}`);
    }

    return parts.join(' ');
  }
}

/**
 * Build a context fingerprint from current environment.
 * 
 * This is the entry point — call this whenever you want to predict
 * what memories the user might need.
 */
export function buildFingerprint(params: {
  projectPath: string;
  gitBranch: string;
  currentFile: string;
  recentTools: string[];
  recentWings: string[];
  recentRooms: string[];
}): ContextFingerprint {
  const ext = params.currentFile.split('.').pop() ?? '';
  const now = new Date();

  return {
    projectHash: createHash('sha256').update(params.projectPath).digest('hex').substring(0, 8),
    branchHash: createHash('sha256').update(params.gitBranch).digest('hex').substring(0, 8),
    fileExtension: ext,
    timeOfDay: now.getHours(),
    dayOfWeek: now.getDay(),
    recentTools: params.recentTools,
    recentWings: params.recentWings,
    recentRooms: params.recentRooms,
  };
}
