# LongMemEval-S Benchmark Results

## Dataset

- **Source:** xiaowu0162/longmemeval-cleaned
- **File:** `longmemeval_s_cleaned.json`
- **Questions:** 500
- **Sessions per question:** ~48
- **Total tokens:** ~115K
- **Embedding model:** all-MiniLM-L6-v2 (384d)

## Methodology

For each question:
1. Create a fresh in-memory SQLite database.
2. Index all haystack sessions.
3. Search with the question text.
4. Check if any `answer_session_ids` appears in the top-k results.

Metric: **R@5** (recall@5) — percentage of questions where at least one gold session is in the top-5 results.

## Results Summary

| Configuration | R@5 (50 q) | R@10 (50 q) | Avg Latency | Index Time |
|---|---|---|---|---|
| Session-level (baseline) | 84.0% | — | ~5 ms | ~30 s |
| Turn-level (all turns) | **94.0%** | 94.0% | ~5.5 ms | ~560 s |
| Turn-level (assistant only) | 86.0% | — | ~3.6 ms | ~296 s |
| Turn-level (2-turn windows) | 85.0% | 90.0% | ~5.3 ms | ~220 s |
| Turn-level + pure vector | 94.0% | 94.0% | ~5.4 ms | ~562 s |
| Turn-level + hybrid | 94.0% | — | ~5.7 ms | ~570 s |
| Turn-level + query reformulation ("A:") | 85.0% | 85.0% | ~5.7 ms | ~224 s |

## Key Findings

1. **Granularity is the biggest lever.** Moving from session-level (1 doc / session) to turn-level (1 doc / message) improved R@5 by **+10 percentage points** (84% → 94%).

2. **All turns matter.** Indexing only assistant turns dropped R@5 to 86%. User questions provide important semantic signal.

3. **Sliding windows hurt.** Pairing consecutive turns into 2-turn windows reduced R@5 to 85%. Individual turns are more discriminable.

4. **Hybrid vs pure vector.** No difference on this dataset (both 94%). The vector signal dominates.

5. **Fetch factor.** Increasing vector fetch from `limit*2` to `limit*10` had no effect — the correct turns are already in the top-10, and the top-5 selection is stable.

6. **R@10 = R@5.** On the 50-question subset, R@10 equals R@5, confirming that misses are not near-misses — the relevant turns are genuinely outside the retrieved set.

7. **Query reformulation hurts.** Prepending "A:" to questions dropped R@5 to 85%.

## Implementation Details

- **Tokenizer:** Xenova AutoTokenizer (HuggingFace-compatible)
- **Embedding:** @xenova/transformers pipeline (mean pooling, L2 normalized)
- **Vector DB:** sqlite-vss v0.1.2 (darwin-arm64)
- **Batching:** `embedBatch()` processes 8 texts at a time
- **VSS indexing:** `indexVectorsBatch()` inserts all vectors in a single transaction
- **DB:** `:memory:` for speed
- **Shared engine:** Single `EmbeddingEngine` reused across all questions

## Remaining Gap to 96%

Current best: **94.0%** on 50 questions. The gap to 96% may be due to:

- **Subset variance:** The first 50 questions might be harder than average. The 100-question run was cut off at 50 with identical 94% recall.
- **Embedding differences:** The paper may use a slightly different preprocessing or model variant.
- **Need for more sophisticated techniques:** Keyphrase extraction or cross-encoder re-ranking could close the gap, but add complexity.

## Running the Benchmark

```bash
# 50 questions (default)
npx tsx benchmarks/longmemeval.ts

# 100 questions
npx tsx benchmarks/longmemeval.ts 100

# Custom top-k
npx tsx benchmarks/longmemeval.ts 50 10
```
