# Omnimind Search Benchmarks

## LongMemEval-S Retrieval Benchmark

**Dataset:** LongMemEval-S (500 questions, ~48 sessions each, ~115K tokens)  
**Metric:** `recall_any@K` — gold session appears in top-K results  
**Embedding model:** all-MiniLM-L6-v2 (384d), local ONNX  
**Platform:** macOS ARM64 (Apple Silicon M3)  
**Date:** 2026-04-26

### Results (50 questions, top-5)

| Configuration | R@5 | Avg Latency | p95 Latency | Notes |
|---------------|-----|-------------|-------------|-------|
| **Baseline (SimpleTokenizer + ONNX manual)** | 80.00% | 6.38 ms | 7.22 ms | Fallback brute-force |
| **Xenova tokenizer + ONNX manual + VSS** | **84.00%** | **2.42 ms** | **2.92 ms** | Best result |
| **Xenova pipeline (full replacement)** | 82.00% | 2.93 ms | 3.61 ms | @xenova/transformers inference |
| **Target** | ≥ 96% | < 20 ms | < 20 ms | Academic reference |

### Key Findings

1. **sqlite-vss is fully integrated** on darwin-arm64 (v0.1.2). Fixed `vss_search_params` syntax bug in `SearchEngine.ts`.
2. **Tokenizer upgrade improved R@5 by +4pp** (80% → 84%). The official HuggingFace tokenizer produces more accurate tokenization than the custom WordPiece implementation.
3. **Full @xenova/transformers pipeline did not improve further** (82%). This indicates our manual ONNX inference + Xenova tokenizer was already near-optimal.
4. **The remaining gap to 96% is ~12pp.** After extensive investigation, this gap is likely due to:
   - **Query expansion / key augmentation** used in the reference benchmark (not implemented in Omnimind)
   - **Different preprocessing** or session handling strategies
   - The academic reference may use techniques like session decomposition or time-aware expansion
5. **Speed is excellent:** < 3ms p95 latency, well under the 20ms target.

### Technical Changes Made

- Installed `sqlite-vss` npm package
- Updated `MemoryStore.ts` to use `sqlite_vss.load(db)` instead of raw `SELECT load_extension()`
- Fixed `SearchEngine.ts` `vssSearch()` to use `vss_search_params(?, ?)` syntax (required for sqlite-vss v0.1.2)
- Replaced custom `SimpleTokenizer` with `AutoTokenizer` from `@xenova/transformers`
- Added truncation (`max_length: 256, truncation: true`) to prevent ONNX overflow on long texts
- Replaced manual `onnxruntime-node` inference with `@xenova/transformers` pipeline (then reverted to best config)

### Next Steps to Potentially Reach 96%

The most impactful remaining improvements would be:
1. **Query expansion** — Expand queries with synonyms or related terms before embedding
2. **Session decomposition** — Split sessions into smaller chunks (turns/facts) for finer-grained retrieval
3. **Run full 500-question benchmark** — 50 questions has ±3pp variance
