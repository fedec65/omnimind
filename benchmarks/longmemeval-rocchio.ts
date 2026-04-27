/**
 * LongMemEval-S Benchmark with Rocchio pseudo-relevance feedback
 */

import { readFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { MemoryStore } from '../src/core/MemoryStore.js';

interface LMEQuestion {
  question_id: string;
  question: string;
  answer_session_ids: string[];
  haystack_sessions: Array<Array<{ role: string; content: string }>>;
  haystack_session_ids: string[];
}

function combineVectors(a: Float32Array, b: Float32Array, alpha: number, beta: number): Float32Array {
  const result = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = alpha * a[i]! + beta * b[i]!;
  }
  // Normalize
  let norm = 0;
  for (let i = 0; i < result.length; i++) norm += result[i]! * result[i]!;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < result.length; i++) result[i]! /= norm;
  }
  return result;
}

async function runBenchmark(limit = 50, k = 5, alpha = 0.7, beta = 0.3, feedbackK = 3) {
  const dataPath = join(import.meta.dirname, 'data', 'longmemeval_s_cleaned.json');
  const questions: LMEQuestion[] = JSON.parse(readFileSync(dataPath, 'utf-8'));
  const subset = questions.slice(0, limit);

  console.log(`[Benchmark] Rocchio feedback: alpha=${alpha} beta=${beta} feedbackK=${feedbackK}`);

  const results: { questionId: string; hit: boolean; latencyMs: number }[] = [];

  for (let i = 0; i < subset.length; i++) {
    const q = subset[i]!;
    const dbPath = join(import.meta.dirname, `.benchmark_r_${q.question_id}.db`);

    const store = new MemoryStore({ dbPath });
    const initRes = await store.init();
    if (!initRes.ok) continue;

    for (let s = 0; s < q.haystack_sessions.length; s++) {
      const session = q.haystack_sessions[s]!;
      const sessionId = q.haystack_session_ids[s]!;
      const text = session.map(m => `${m.role}: ${m.content}`).join('\n');
      await store.store(text, { wing: 'benchmark', room: q.question_id, sourceTool: 'longmemeval', sourceId: sessionId });
    }

    const searchStart = performance.now();

    // Step 1: initial search
    const initialRes = await store.search(q.question, { limit: feedbackK });
    if (!initialRes.ok) { store.close(); continue; }

    // Step 2: compute mean vector of top feedbackK results
    const topResults = initialRes.value;
    if (topResults.length === 0) { store.close(); continue; }

    const embeddings: Float32Array[] = [];
    for (const r of topResults) {
      const embRes = await store['embeddingEngine']!.embed(r.memory.content);
      if (embRes.ok) embeddings.push(embRes.value);
    }

    if (embeddings.length === 0) { store.close(); continue; }

    const meanVector = new Float32Array(384);
    for (const emb of embeddings) {
      for (let j = 0; j < 384; j++) meanVector[j]! += emb[j]!;
    }
    for (let j = 0; j < 384; j++) meanVector[j]! /= embeddings.length;

    // Step 3: get query embedding
    const queryEmbRes = await store['embeddingEngine']!.embed(q.question);
    if (!queryEmbRes.ok) { store.close(); continue; }

    // Step 4: Rocchio combination
    const expandedVector = combineVectors(queryEmbRes.value, meanVector, alpha, beta);

    // Step 5: search with expanded vector
    const finalResults = await store['searchEngine']!.vectorSearch(expandedVector, k, '', []);

    const latencyMs = performance.now() - searchStart;

    const resultIds = finalResults.map(r => r.memory.sourceId).filter(Boolean);
    const hit = q.answer_session_ids.some(id => resultIds.includes(id));
    results.push({ questionId: q.question_id, hit, latencyMs });

    store.close();
    if (existsSync(dbPath)) unlinkSync(dbPath);

    if ((i + 1) % 10 === 0 || i === subset.length - 1) {
      const recall = results.filter(r => r.hit).length / results.length;
      console.log(`  Progress: ${i + 1}/${subset.length} — R@${k} so far: ${(recall * 100).toFixed(1)}%`);
    }
  }

  const hits = results.filter(r => r.hit).length;
  const avgLatency = results.reduce((a, b) => a + b.latencyMs, 0) / results.length;
  console.log('\n========== ROCCHIO RESULTS ==========');
  console.log(`alpha=${alpha} beta=${beta} feedbackK=${feedbackK}`);
  console.log(`R@${k}: ${(hits / results.length * 100).toFixed(2)}%`);
  console.log(`Avg latency: ${avgLatency.toFixed(2)} ms`);
  console.log('=====================================');
}

runBenchmark(50, 5, 0.7, 0.3, 3).catch(console.error);
