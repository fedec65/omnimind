/**
 * EmbeddingEngine — Local text embedding via @xenova/transformers
 *
 * Uses the official HuggingFace all-MiniLM-L6-v2 model through the
 * @xenova/transformers pipeline. This guarantees bit-exact compatibility
 * with the reference sentence-transformers implementation.
 *
 * First run downloads ~80MB model automatically.
 * Subsequent runs are instant.
 */

import { pipeline } from '@xenova/transformers';
import { type Result, ok, err } from './types.js';

/** Default model configuration */
const MODEL_CONFIG = {
  modelName: 'all-MiniLM-L6-v2',
  dimensions: 384,
  maxSequenceLength: 256,
} as const;

export interface EmbeddingEngineConfig {
  maxSequenceLength?: number;
}

interface ExtractorOutput {
  data: Float32Array;
  dims: number[];
}

type ExtractorFn = (
  text: string | string[],
  opts?: { pooling?: string; normalize?: boolean }
) => Promise<ExtractorOutput>;

/**
 * Local embedding engine using @xenova/transformers pipeline.
 *
 * Usage:
 * ```typescript
 * const engine = new EmbeddingEngine();
 * await engine.init();
 *
 * const embedding = await engine.embed("Hello world");
 * if (embedding.ok) {
 *   console.log(embedding.value.length); // 384
 * }
 * ```
 */
export class EmbeddingEngine {
  private extractor: ExtractorFn | null = null;
  private readonly maxSequenceLength: number;
  private initialized = false;

  constructor(config: EmbeddingEngineConfig = {}) {
    this.maxSequenceLength = config.maxSequenceLength ?? MODEL_CONFIG.maxSequenceLength;
  }

  /** Initialize the pipeline */
  async init(): Promise<Result<void>> {
    try {
      this.extractor = (await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')) as unknown as ExtractorFn;
      this.initialized = true;
      console.log(`[EmbeddingEngine] Loaded ${MODEL_CONFIG.modelName} (${MODEL_CONFIG.dimensions}d)`);
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Embed a single text string into a 384-dimensional vector.
   *
   * Latency target: < 20ms for texts under 100 tokens
   */
  async embed(text: string): Promise<Result<Float32Array>> {
    if (!this.initialized || !this.extractor) {
      return err(new Error('EmbeddingEngine not initialized'));
    }

    try {
      const trimmed = text.trim();
      if (!trimmed) {
        return ok(new Float32Array(MODEL_CONFIG.dimensions));
      }

      const output = await this.extractor(trimmed, {
        pooling: 'mean',
        normalize: true,
      });

      const embedding = output.data as Float32Array;
      return ok(embedding);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Embed multiple texts in a batch (faster than individual calls).
   *
   * Latency target: < 50ms for batch of 10 texts
   */
  async embedBatch(texts: string[]): Promise<Result<Float32Array[]>> {
    if (!this.initialized || !this.extractor) {
      return err(new Error('EmbeddingEngine not initialized'));
    }

    try {
      const results: Float32Array[] = [];

      // Process in chunks to avoid OOM and leverage pipeline batching
      const batchSize = 8;
      for (let i = 0; i < texts.length; i += batchSize) {
        const chunk = texts.slice(i, i + batchSize);
        const output = await this.extractor(chunk, {
          pooling: 'mean',
          normalize: true,
        });

        // When batching, output is a single Float32Array of shape [batch, 384]
        const data = output.data as Float32Array;
        for (let b = 0; b < chunk.length; b++) {
          const start = b * MODEL_CONFIG.dimensions;
          results.push(data.slice(start, start + MODEL_CONFIG.dimensions));
        }
      }

      return ok(results);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Get model info */
  getInfo(): { model: string; dimensions: number; maxLength: number } {
    return {
      model: MODEL_CONFIG.modelName,
      dimensions: MODEL_CONFIG.dimensions,
      maxLength: this.maxSequenceLength,
    };
  }
}
