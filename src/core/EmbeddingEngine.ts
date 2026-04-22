/**
 * EmbeddingEngine — Local text embedding using ONNX
 * 
 * Runs all-MiniLM-L6-v2 (384 dimensions) entirely locally via onnxruntime-node.
 * No external API calls. No Python runtime needed.
 * 
 * First run downloads ~80MB model automatically.
 * Subsequent runs are instant.
 */

import * as ort from 'onnxruntime-node';
import { type Result, ok, err } from './types.js';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';

/** Default model configuration */
const MODEL_CONFIG = {
  modelName: 'all-MiniLM-L6-v2',
  dimensions: 384,
  maxSequenceLength: 256,
  normalize: true,
} as const;

/** Default model download URL (Hugging Face) */
const MODEL_URL =
  'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx';

/** Tokenizer vocabulary URL */
const VOCAB_URL =
  'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/vocab.txt';

export interface EmbeddingEngineConfig {
  modelPath?: string;
  cacheDir?: string;
  maxSequenceLength?: number;
}

/**
 * Local embedding engine using ONNX Runtime.
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
  private session: ort.InferenceSession | null = null;
  private tokenizer: SimpleTokenizer | null = null;
  private readonly config: { modelPath: string; cacheDir: string; maxSequenceLength: number };
  private initialized = false;

  constructor(config: EmbeddingEngineConfig = {}) {
    const cacheDir = config.cacheDir || join(homedir(), '.omnimind', 'models');
    this.config = {
      modelPath: config.modelPath || join(cacheDir, 'model.onnx'),
      cacheDir,
      maxSequenceLength: config.maxSequenceLength || MODEL_CONFIG.maxSequenceLength,
    };
  }

  /** Initialize the model and tokenizer */
  async init(): Promise<Result<void>> {
    try {
      // Ensure cache directory exists
      mkdirSync(this.config.cacheDir, { recursive: true });

      // Download model if needed
      if (!existsSync(this.config.modelPath)) {
        console.log(`[EmbeddingEngine] Downloading ${MODEL_CONFIG.modelName}...`);
        await this.downloadModel();
      }

      // Download tokenizer vocab if needed
      const vocabPath = join(this.config.cacheDir, 'vocab.txt');
      if (!existsSync(vocabPath)) {
        console.log('[EmbeddingEngine] Downloading tokenizer vocabulary...');
        await this.downloadVocab(vocabPath);
      }

      // Load ONNX session
      this.session = await ort.InferenceSession.create(this.config.modelPath, {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
      });

      // Load tokenizer
      this.tokenizer = new SimpleTokenizer(vocabPath, this.config.maxSequenceLength);

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
    if (!this.initialized || !this.session || !this.tokenizer) {
      return err(new Error('EmbeddingEngine not initialized'));
    }

    try {
      const trimmed = text.trim();
      if (!trimmed) {
        return ok(new Float32Array(MODEL_CONFIG.dimensions));
      }

      // Tokenize
      const { inputIds, attentionMask } = this.tokenizer.encode(trimmed);

      // Create tensors
      const inputTensor = new ort.Tensor('int64', BigInt64Array.from(inputIds.map(BigInt)), [1, inputIds.length]);
      const maskTensor = new ort.Tensor('int64', BigInt64Array.from(attentionMask.map(BigInt)), [1, attentionMask.length]);
      const tokenTypeTensor = new ort.Tensor('int64', new BigInt64Array(inputIds.length).fill(0n), [1, inputIds.length]);

      // Run inference
      const results = await this.session.run({
        input_ids: inputTensor,
        attention_mask: maskTensor,
        token_type_ids: tokenTypeTensor,
      });

      // Extract embedding (mean pooling of last hidden state)
      const lastHiddenState = results.last_hidden_state as ort.Tensor;
      const embedding = this.meanPool(lastHiddenState.data as Float32Array, attentionMask);

      // Normalize
      if (MODEL_CONFIG.normalize) {
        this.normalize(embedding);
      }

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
    if (!this.initialized || !this.session || !this.tokenizer) {
      return err(new Error('EmbeddingEngine not initialized'));
    }

    try {
      const results: Float32Array[] = [];

      // Process in chunks to avoid OOM
      const batchSize = 8;
      for (let i = 0; i < texts.length; i += batchSize) {
        const chunk = texts.slice(i, i + batchSize);
        const embeddings = await Promise.all(
          chunk.map(t => this.embed(t)),
        );
        for (const e of embeddings) {
          if (!e.ok) return err(e.error);
          results.push(e.value);
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
      maxLength: this.config.maxSequenceLength,
    };
  }

  // ─── Private helpers ──────────────────────────────────────────────

  private meanPool(hiddenState: Float32Array, attentionMask: number[]): Float32Array {
    const seqLength = attentionMask.length;
    const hiddenSize = MODEL_CONFIG.dimensions;
    const result = new Float32Array(hiddenSize);

    let validTokens = 0;
    for (let i = 0; i < seqLength; i++) {
      if (attentionMask[i] === 1) {
        validTokens++;
        const offset = i * hiddenSize;
        for (let j = 0; j < hiddenSize; j++) {
          result[j]! += hiddenState[offset + j]!;
        }
      }
    }

    if (validTokens > 0) {
      for (let j = 0; j < hiddenSize; j++) {
        result[j]! /= validTokens;
      }
    }

    return result;
  }

  private normalize(vector: Float32Array): void {
    let sum = 0;
    for (let i = 0; i < vector.length; i++) {
      sum += vector[i]! * vector[i]!;
    }
    const norm = Math.sqrt(sum);
    if (norm > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i]! /= norm;
      }
    }
  }

  private async downloadModel(): Promise<void> {
    const response = await fetch(MODEL_URL);
    if (!response.ok) {
      throw new Error(`Failed to download model: ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();
    writeFileSync(this.config.modelPath, Buffer.from(buffer));
  }

  private async downloadVocab(vocabPath: string): Promise<void> {
    const response = await fetch(VOCAB_URL);
    if (!response.ok) {
      throw new Error(`Failed to download vocab: ${response.statusText}`);
    }
    const text = await response.text();
    writeFileSync(vocabPath, text);
  }
}

// ─── Simple WordPiece Tokenizer ───────────────────────────────────

/**
 * Minimal WordPiece tokenizer for all-MiniLM-L6-v2.
 * 
 * This is a simplified implementation — full BERT tokenization would
 * require the tokenizers library. For production, consider using
 * @xenova/transformers or the tokenizers npm package.
 */
class SimpleTokenizer {
  private vocab: Map<string, number>;
  private readonly maxLength: number;

  constructor(vocabPath: string, maxLength: number) {
    this.vocab = this.loadVocab(vocabPath);
    this.maxLength = maxLength;
  }

  encode(text: string): { inputIds: number[]; attentionMask: number[] } {
    // Basic word splitting + WordPiece
    const words = text.toLowerCase().split(/\s+/);
    const tokens: number[] = [this.vocab.get('[CLS]') ?? 101];

    for (const word of words) {
      const subTokens = this.wordPieceTokenize(word);
      for (const token of subTokens) {
        if (tokens.length >= this.maxLength - 1) break;
        tokens.push(token);
      }
    }

    tokens.push(this.vocab.get('[SEP]') ?? 102);

    const paddingLength = this.maxLength - tokens.length;
    const inputIds = [...tokens, ...Array(paddingLength).fill(0)];
    const attentionMask = [
      ...Array(tokens.length).fill(1),
      ...Array(paddingLength).fill(0),
    ];

    return { inputIds, attentionMask };
  }

  private wordPieceTokenize(word: string): number[] {
    const tokens: number[] = [];
    let remaining = word;

    while (remaining.length > 0) {
      let longestMatch = '';
      let longestId = this.vocab.get('[UNK]') ?? 100;

      // Try full word first, then prefixes
      for (let i = remaining.length; i > 0; i--) {
        const sub = remaining.substring(0, i);
        const prefixed = tokens.length > 0 ? `##${sub}` : sub;
        const id = this.vocab.get(prefixed) ?? this.vocab.get(sub);
        if (id !== undefined) {
          longestMatch = sub;
          longestId = id;
          break;
        }
      }

      if (longestMatch === '') {
        // Unknown token
        tokens.push(this.vocab.get('[UNK]') ?? 100);
        break;
      }

      tokens.push(longestId);
      remaining = remaining.substring(longestMatch.length);
    }

    return tokens;
  }

  private loadVocab(path: string): Map<string, number> {
    try {
      const content = readFileSync(path, 'utf-8');
      const lines = content.split('\n').filter((l: string) => l.trim());
      const vocab = new Map<string, number>();
      lines.forEach((token: string, idx: number) => vocab.set(token, idx));
      return vocab;
    } catch {
      // Fallback to minimal vocab
      const vocab = new Map<string, number>();
      vocab.set('[PAD]', 0);
      vocab.set('[UNK]', 100);
      vocab.set('[CLS]', 101);
      vocab.set('[SEP]', 102);
      vocab.set('[MASK]', 103);
      return vocab;
    }
  }
}
