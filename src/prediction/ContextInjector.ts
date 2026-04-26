/**
 * ContextInjector — Bridge between predictions and MCP context
 *
 * Exposes predictions as:
 * - MCP Resource: `omnimind://context/predictions`
 * - MCP Prompt: `omnimind://prompts/memory-aware`
 * - Auto-injection into search results
 *
 * Target: < 150 tokens total context addition.
 */

import { type Memory, type ContextFingerprint, type Result, ok, err } from '../core/types.js';
import { type IntentPredictor, type Prediction } from './IntentPredictor.js';

export interface InjectorConfig {
  /** Maximum tokens to inject (default: 150) */
  tokenBudget?: number;
  /** Maximum predictions to include (default: 3) */
  maxPredictions?: number;
  /** Minimum confidence to include (default: 0.7) */
  minConfidence?: number;
}

export interface InjectionResult {
  readonly text: string;
  readonly tokenEstimate: number;
  readonly predictionCount: number;
  readonly avgConfidence: number;
}

export class ContextInjector {
  private readonly predictor: IntentPredictor;
  private readonly memoryFetcher: (id: string) => Promise<Memory | null>;
  private readonly config: Required<InjectorConfig>;

  constructor(
    predictor: IntentPredictor,
    memoryFetcher: (id: string) => Promise<Memory | null>,
    config: InjectorConfig = {},
  ) {
    this.predictor = predictor;
    this.memoryFetcher = memoryFetcher;
    this.config = {
      tokenBudget: config.tokenBudget ?? 150,
      maxPredictions: config.maxPredictions ?? 3,
      minConfidence: config.minConfidence ?? 0.7,
    };
  }

  /**
   * Generate context injection for the current fingerprint.
   *
   * This is the primary entry point — call this before every
   * MCP tool invocation to pre-load relevant memories.
   */
  async inject(fingerprint: ContextFingerprint): Promise<Result<InjectionResult>> {
    const startTime = performance.now();

    try {
      const predictions = await this.predictor.predict(fingerprint, this.memoryFetcher);
      if (!predictions.ok) return err(predictions.error);

      const filtered = predictions.value
        .filter((p) => p.confidence >= this.config.minConfidence)
        .slice(0, this.config.maxPredictions);

      if (filtered.length === 0) {
        return ok({ text: '', tokenEstimate: 0, predictionCount: 0, avgConfidence: 0 });
      }

      const result = await this.formatInjection(filtered);

      const latency = performance.now() - startTime;
      if (latency > 5) {
        console.warn(`[ContextInjector] Slow injection: ${latency.toFixed(1)}ms`);
      }

      return ok(result);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Format predictions as compact XML for context injection.
   *
   * Format:
   * ```xml
   * <omnimind_predictions confidence="0.85" count="2">
   * [wing/room] Truncated memory content...
   * [wing/room] Another memory...
   * </omnimind_predictions>
   * ```
   */
  async formatInjection(predictions: Prediction[]): Promise<InjectionResult> {
    if (predictions.length === 0) {
      return { text: '', tokenEstimate: 0, predictionCount: 0, avgConfidence: 0 };
    }

    const lines: string[] = [];
    let tokenEstimate = 0;

    for (const pred of predictions) {
      if (tokenEstimate > this.config.tokenBudget) break;

      const memory = await this.memoryFetcher(pred.memoryId);
      if (!memory) continue;

      const line = `[${memory.wing}/${memory.room}] ${memory.content.substring(0, 200)}`;
      lines.push(line);
      tokenEstimate += line.split(/\s+/).length;
    }

    if (lines.length === 0) {
      return { text: '', tokenEstimate: 0, predictionCount: 0, avgConfidence: 0 };
    }

    const avgConfidence = predictions.reduce((s, p) => s + p.confidence, 0) / predictions.length;
    const text = `\n<omnimind_predictions confidence="${avgConfidence.toFixed(2)}" count="${lines.length}">\n${lines.join('\n')}\n</omnimind_predictions>\n`;

    return {
      text,
      tokenEstimate,
      predictionCount: lines.length,
      avgConfidence,
    };
  }

  /**
   * Get predictions as a plain JSON object (for MCP resources).
   */
  async getPredictionsResource(fingerprint: ContextFingerprint): Promise<Result<unknown>> {
    const predictions = await this.predictor.predict(fingerprint, this.memoryFetcher);
    if (!predictions.ok) return err(predictions.error);

    const enriched = await Promise.all(
      predictions.value.map(async (p) => {
        const memory = await this.memoryFetcher(p.memoryId);
        return {
          memoryId: p.memoryId,
          confidence: p.confidence,
          reason: p.reason,
          wing: memory?.wing ?? null,
          room: memory?.room ?? null,
          preview: memory?.content.substring(0, 200) ?? null,
        };
      }),
    );

    return ok({
      timestamp: Date.now(),
      predictions: enriched,
      stats: this.predictor.getStats(),
    });
  }

  /**
   * Get a memory-aware system prompt (for MCP prompts).
   */
  async getMemoryAwarePrompt(fingerprint: ContextFingerprint): Promise<Result<string>> {
    const injection = await this.inject(fingerprint);
    if (!injection.ok) return err(injection.error);

    const basePrompt = `You have access to the user's Omnimind memory system — a local, privacy-first knowledge store. Relevant memories may be injected into context automatically.`;

    if (injection.value.text) {
      return ok(`${basePrompt}\n\n${injection.value.text}`);
    }

    return ok(basePrompt);
  }
}
