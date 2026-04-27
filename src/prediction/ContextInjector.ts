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

import { MemoryLayer, type Memory, type ContextFingerprint, type Result, ok, err } from '../core/types.js';
import { type IntentPredictor, type Prediction } from './IntentPredictor.js';

export interface InjectorConfig {
  /** Maximum tokens to inject (default: 150) */
  tokenBudget?: number;
  /** Maximum predictions to include (default: 3) */
  maxPredictions?: number;
  /** Minimum confidence to include (default: 0.7) */
  minConfidence?: number;
  /** Maximum characters per memory line before truncation (default: 200) */
  maxCharsPerMemory?: number;
}

export interface InjectionResult {
  readonly text: string;
  readonly tokenEstimate: number;
  readonly predictionCount: number;
  readonly avgConfidence: number;
}

/** Single entry in the injection with its cost metadata */
interface InjectionEntry {
  line: string;
  tokens: number;
  confidence: number;
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
      maxCharsPerMemory: config.maxCharsPerMemory ?? 200,
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
   * Compression strategy (3-level):
   * 1. If memory has a compressed ref (L1), use the compressed text.
   * 2. Smart truncation: preserve start and end, cut the middle.
   * 3. If still over budget, evict the least-confident prediction.
   */
  async formatInjection(predictions: Prediction[]): Promise<InjectionResult> {
    if (predictions.length === 0) {
      return { text: '', tokenEstimate: 0, predictionCount: 0, avgConfidence: 0 };
    }

    // Sort by confidence descending so we try to keep the best ones
    const sorted = [...predictions].sort((a, b) => b.confidence - a.confidence);

    // Fixed overhead: XML tags + newlines
    const overhead = this.estimateTokens(`\n<omnimind_predictions confidence="0.00" count="${sorted.length}">\n\n</omnimind_predictions>\n`);

    let entries: InjectionEntry[] = [];
    let attempts = 0;
    const maxAttempts = sorted.length;

    while (attempts <= maxAttempts) {
      const active = sorted.slice(0, sorted.length - attempts);
      if (active.length === 0) break;

      const budgetPerLine = Math.max(
        30,
        Math.floor((this.config.tokenBudget - overhead) / active.length),
      );
      const charsPerLine = Math.min(
        this.config.maxCharsPerMemory,
        budgetPerLine * 4, // rough chars-per-token estimate
      );

      entries = [];
      let totalTokens = overhead;

      for (const pred of active) {
        const memory = await this.memoryFetcher(pred.memoryId);
        if (!memory) continue;

        const line = this.buildLine(memory, charsPerLine);
        const tokens = this.estimateTokens(line);
        entries.push({ line, tokens, confidence: pred.confidence });
        totalTokens += tokens;
      }

      if (totalTokens <= this.config.tokenBudget) {
        break; // Budget respected
      }

      // Over budget — evict the lowest-confidence entry and retry
      attempts++;
    }

    if (entries.length === 0) {
      return { text: '', tokenEstimate: 0, predictionCount: 0, avgConfidence: 0 };
    }

    const avgConfidence = entries.reduce((s, e) => s + e.confidence, 0) / entries.length;
    const tokenEstimate = overhead + entries.reduce((s, e) => s + e.tokens, 0);
    const text = `\n<omnimind_predictions confidence="${avgConfidence.toFixed(2)}" count="${entries.length}">\n${entries.map((e) => e.line).join('\n')}\n</omnimind_predictions>\n`;

    return {
      text,
      tokenEstimate,
      predictionCount: entries.length,
      avgConfidence,
    };
  }

  /**
   * Build a single injection line for a memory, applying compression.
   *
   * Level 1: Use L1 compressed text if available.
   * Level 2: Smart truncation preserving start + end.
   */
  private buildLine(memory: Memory, maxChars: number): string {
    // Level 1: Use compressed reference (L1) if available
    if (memory.compressedRef && memory.layer >= MemoryLayer.Compressed) {
      const compressed = `[${memory.wing}/${memory.room}] ${memory.compressedRef}`;
      if (compressed.length <= maxChars) return compressed;
      // Even compressed might be too long — fall through to truncation
    }

    const prefix = `[${memory.wing}/${memory.room}] `;
    const content = memory.content;
    const available = maxChars - prefix.length;

    if (content.length <= available) {
      return `${prefix}${content}`;
    }

    // Level 2: Smart truncation — preserve start and end
    const half = Math.floor(available / 2) - 3; // 3 chars for "..."
    const start = content.slice(0, half);
    const end = content.slice(-half);
    return `${prefix}${start}...${end}`;
  }

  /** Rough token estimation (words + punctuation) */
  private estimateTokens(text: string): number {
    return text.split(/\s+/).length;
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
