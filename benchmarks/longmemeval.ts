/**
 * LongMemEval-S Benchmark for Omnimind
 * 
 * Evaluates retrieval recall on the LongMemEval-S dataset.
 * Metric: recall_any@K — is any gold session in the top-K results?
 * 
 * Usage:
 *   npx tsx benchmarks/longmemeval.ts [limit] [k]
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { MemoryStore } from '../src/core/MemoryStore.js';
import { EmbeddingEngine } from '../src/core/EmbeddingEngine.js';

interface LMEQuestion {
  question_id: string;
  question: string;
  answer_session_ids: string[];
  haystack_sessions: Array<Array<{ role: string; content: string }>>;
  haystack_session_ids: string[];
}

interface BenchmarkResult {
  questionId: string;
  hitAt5: boolean;
  hitAt10: boolean;
  latencyMs: number;
}

async function runBenchmark(limit = 50, k = 5) {
  const dataPath = join(import.meta.dirname, 'data', 'longmemeval_s_cleaned.json');
  const questions: LMEQuestion[] = JSON.parse(readFileSync(dataPath, 'utf-8'));
  const subset = questions.slice(0, limit);

  console.log(`[Benchmark] Running LongMemEval-S: ${subset.length} questions, top-${k}`);

  // Share a single embedding engine across all questions to avoid re-loading the model
  const embeddingEngine = new EmbeddingEngine();
  const embedInit = await embeddingEngine.init();
  if (!embedInit.ok) {
    console.error('[Benchmark] Failed to init embedding engine:', embedInit.error.message);
    return;
  }

  const results: BenchmarkResult[] = [];
  let totalIndexTime = 0;

  for (let i = 0; i < subset.length; i++) {
    const q = subset[i]!;

    const store = new MemoryStore({ dbPath: ':memory:', embeddingEngine });
    const initRes = await store.init();
    if (!initRes.ok) {
      console.error(`[Benchmark] Failed to init store for ${q.question_id}:`, initRes.error.message);
      continue;
    }

    // Index all haystack sessions as individual turns
    const indexStart = performance.now();
    for (let s = 0; s < q.haystack_sessions.length; s++) {
      const session = q.haystack_sessions[s]!;
      const sessionId = q.haystack_session_ids[s]!;
      const turns = session.map(m => `${m.role}: ${m.content}`);
      await store.storeTurns(turns, {
        wing: 'benchmark',
        room: q.question_id,
        sourceTool: 'longmemeval',
        sourceId: sessionId,
      });
    }
    totalIndexTime += performance.now() - indexStart;

    // Search with the question (pure vector — matches LongMemEval paper)
    // Always fetch 10 so we can report both R@5 and R@10
    const searchStart = performance.now();
    const searchResults = await store.search(q.question, { limit: 10, vectorOnly: true });
    const latencyMs = performance.now() - searchStart;

    const resultIds = searchResults.ok
      ? searchResults.value.map(r => r.memory.sourceId).filter(Boolean)
      : [];

    const hitAt5 = q.answer_session_ids.some(id => resultIds.slice(0, 5).includes(id));
    const hitAt10 = q.answer_session_ids.some(id => resultIds.slice(0, 10).includes(id));

    results.push({ questionId: q.question_id, hitAt5, hitAt10, latencyMs });

    store.close();

    if ((i + 1) % 10 === 0 || i === subset.length - 1) {
      const currentR5 = results.filter(r => r.hitAt5).length / results.length;
      const currentR10 = results.filter(r => r.hitAt10).length / results.length;
      console.log(`  Progress: ${i + 1}/${subset.length} — R@5: ${(currentR5 * 100).toFixed(1)}% | R@10: ${(currentR10 * 100).toFixed(1)}%`);
    }
  }

  const hitsAt5 = results.filter(r => r.hitAt5).length;
  const hitsAt10 = results.filter(r => r.hitAt10).length;
  const avgLatency = results.reduce((a, b) => a + b.latencyMs, 0) / results.length;
  const p95Latency = results.map(r => r.latencyMs).sort((a, b) => a - b)[Math.floor(results.length * 0.95)] ?? 0;

  console.log('\n========== RESULTS ==========');
  console.log(`Questions evaluated: ${results.length}`);
  console.log(`R@5:              ${(hitsAt5 / results.length * 100).toFixed(2)}%`);
  console.log(`R@10:             ${(hitsAt10 / results.length * 100).toFixed(2)}%`);
  console.log(`Avg latency:      ${avgLatency.toFixed(2)} ms`);
  console.log(`p95 latency:      ${p95Latency.toFixed(2)} ms`);
  console.log(`Total index time: ${(totalIndexTime / 1000).toFixed(1)} s`);
  console.log('=============================');
}

const limit = parseInt(process.argv[2] ?? '50', 10);
const k = parseInt(process.argv[3] ?? '5', 10);
runBenchmark(limit, k).catch(console.error);
