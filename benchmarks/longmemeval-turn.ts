/**
 * LongMemEval-S Benchmark — Turn-level retrieval
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

async function runBenchmark(limit = 50, k = 5) {
  const dataPath = join(import.meta.dirname, 'data', 'longmemeval_s_cleaned.json');
  const questions: LMEQuestion[] = JSON.parse(readFileSync(dataPath, 'utf-8'));
  const subset = questions.slice(0, limit);

  console.log('[Benchmark] Running LongMemEval-S (turn-level)...');

  const results: { questionId: string; hit: boolean; latencyMs: number }[] = [];

  for (let i = 0; i < subset.length; i++) {
    const q = subset[i]!;
    const dbPath = join(import.meta.dirname, `.benchmark_t_${q.question_id}.db`);

    const store = new MemoryStore({ dbPath });
    const initRes = await store.init();
    if (!initRes.ok) continue;

    for (let s = 0; s < q.haystack_sessions.length; s++) {
      const session = q.haystack_sessions[s]!;
      const sessionId = q.haystack_session_ids[s]!;
      // Index each turn separately, tagging with parent session ID
      for (let t = 0; t < session.length; t++) {
        const turn = session[t]!;
        const text = `${turn.role}: ${turn.content}`;
        await store.store(text, {
          wing: 'benchmark',
          room: q.question_id,
          sourceTool: 'longmemeval',
          sourceId: sessionId, // tag with session ID
        });
      }
    }

    const searchStart = performance.now();
    const searchResults = await store.search(q.question, { limit: k });
    const latencyMs = performance.now() - searchStart;

    const resultIds = searchResults.ok
      ? searchResults.value.map(r => r.memory.sourceId).filter(Boolean)
      : [];

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
  console.log('\n========== TURN-LEVEL RESULTS ==========');
  console.log(`R@${k}: ${(hits / results.length * 100).toFixed(2)}%`);
  console.log(`Avg latency: ${avgLatency.toFixed(2)} ms`);
  console.log('========================================');
}

runBenchmark(50, 5).catch(console.error);
