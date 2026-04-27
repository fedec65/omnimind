/**
 * LongMemEval-S Benchmark using @xenova/transformers pipeline
 */

import { readFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { pipeline } from '@xenova/transformers';
import Database from 'better-sqlite3';
import * as sqlite_vss from 'sqlite-vss';

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

  console.log('[Benchmark] Running LongMemEval-S with Xenova pipeline...');
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

  const results: { questionId: string; hit: boolean; latencyMs: number }[] = [];

  for (let i = 0; i < subset.length; i++) {
    const q = subset[i]!;
    const dbPath = join(import.meta.dirname, `.benchmark_x_${q.question_id}.db`);
    if (existsSync(dbPath)) unlinkSync(dbPath);

    const db = new Database(dbPath);
    sqlite_vss.load(db);
    db.exec(`CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, content TEXT, source_id TEXT)`);
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vss_memories USING vss0(embedding(384))`);

    const seen = new Set<string>();
    for (let s = 0; s < q.haystack_sessions.length; s++) {
      const session = q.haystack_sessions[s]!;
      const sessionId = q.haystack_session_ids[s]!;
      if (seen.has(sessionId)) continue;
      seen.add(sessionId);
      const text = session.map(m => `${m.role}: ${m.content}`).join('\n');
      const emb = await extractor(text, { pooling: 'mean', normalize: true });
      const vector = emb.data as Float32Array;
      const info = db.prepare('INSERT INTO memories (id, content, source_id) VALUES (?, ?, ?)').run(sessionId, text, sessionId);
      db.prepare('INSERT INTO vss_memories(rowid, embedding) VALUES (?, ?)').run(info.lastInsertRowid, Buffer.from(vector.buffer));
    }

    const searchStart = performance.now();
    const queryEmb = await extractor(q.question, { pooling: 'mean', normalize: true });
    const queryVector = queryEmb.data as Float32Array;
    const rows = db.prepare(`SELECT m.id FROM memories m JOIN vss_memories vss ON m.rowid = vss.rowid WHERE vss_search(embedding, vss_search_params(?, ?))`)
      .all(Buffer.from(queryVector.buffer), k) as Array<{ id: string }>;
    const latencyMs = performance.now() - searchStart;

    const hit = q.answer_session_ids.some(id => rows.some(r => r.id === id));
    results.push({ questionId: q.question_id, hit, latencyMs });

    db.close();
    if (existsSync(dbPath)) unlinkSync(dbPath);

    if ((i + 1) % 10 === 0 || i === subset.length - 1) {
      const recall = results.filter(r => r.hit).length / results.length;
      console.log(`  Progress: ${i + 1}/${subset.length} — R@${k} so far: ${(recall * 100).toFixed(1)}%`);
    }
  }

  const hits = results.filter(r => r.hit).length;
  const avgLatency = results.reduce((a, b) => a + b.latencyMs, 0) / results.length;
  console.log('\n========== XENOVA RESULTS ==========');
  console.log(`R@${k}: ${(hits / results.length * 100).toFixed(2)}%`);
  console.log(`Avg latency: ${avgLatency.toFixed(2)} ms`);
  console.log('====================================');
}

runBenchmark(50, 5).catch(console.error);
