/**
 * EmbeddingEngine — Local text embedding using ONNX
 *
 * Runs all-MiniLM-L6-v2 (384 dimensions) entirely locally via onnxruntime-node.
 * No external API calls. No Python runtime needed.
 *
 * First run downloads ~80MB model automatically.
 * Subsequent runs are instant.
 */
import { type Result } from './types.js';
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
export declare class EmbeddingEngine {
    private session;
    private tokenizer;
    private readonly config;
    private initialized;
    constructor(config?: EmbeddingEngineConfig);
    /** Initialize the model and tokenizer */
    init(): Promise<Result<void>>;
    /**
     * Embed a single text string into a 384-dimensional vector.
     *
     * Latency target: < 20ms for texts under 100 tokens
     */
    embed(text: string): Promise<Result<Float32Array>>;
    /**
     * Embed multiple texts in a batch (faster than individual calls).
     *
     * Latency target: < 50ms for batch of 10 texts
     */
    embedBatch(texts: string[]): Promise<Result<Float32Array[]>>;
    /** Get model info */
    getInfo(): {
        model: string;
        dimensions: number;
        maxLength: number;
    };
    private meanPool;
    private normalize;
    private downloadModel;
    private downloadVocab;
}
//# sourceMappingURL=EmbeddingEngine.d.ts.map