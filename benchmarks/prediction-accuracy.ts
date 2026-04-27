/**
 * Prediction Accuracy Benchmark
 *
 * Simulates a developer workflow to measure IntentPredictor accuracy.
 *
 * Scenario: A developer works on 3 projects across 2 weeks.
 * Each "session" has a context (project + file type + wing) and
 * the developer accesses a specific memory. We train on past sessions
 * and predict for the current one.
 *
 * Metric: Accuracy = % of sessions where the accessed memory
 * appears in the top-N predictions.
 */

import { IntentPredictor, buildFingerprint } from '../src/prediction/IntentPredictor.js';
import { MemoryStore } from '../src/core/MemoryStore.js';
import { MemoryLayer } from '../src/core/types.js';

interface SimulatedSession {
  projectPath: string;
  gitBranch: string;
  currentFile: string;
  wing: string;
  room: string;
  memoryId: string;
}

// Simulate a realistic 2-week developer workflow
function generateWorkflow(): SimulatedSession[] {
  const sessions: SimulatedSession[] = [];

  // Project Alpha — auth feature (10 sessions, mostly auth-related)
  for (let i = 0; i < 10; i++) {
    sessions.push({
      projectPath: '/home/user/projects/alpha',
      gitBranch: 'feature/auth',
      currentFile: i % 2 === 0 ? 'src/auth.ts' : 'src/middleware.ts',
      wing: 'project-alpha',
      room: 'auth',
      memoryId: 'mem_auth_jwt',
    });
  }

  // Project Alpha — API layer (5 sessions, different context)
  for (let i = 0; i < 5; i++) {
    sessions.push({
      projectPath: '/home/user/projects/alpha',
      gitBranch: 'feature/api',
      currentFile: 'src/api.ts',
      wing: 'project-alpha',
      room: 'api',
      memoryId: 'mem_graphql_decision',
    });
  }

  // Project Beta — UI work (8 sessions)
  for (let i = 0; i < 8; i++) {
    sessions.push({
      projectPath: '/home/user/projects/beta',
      gitBranch: 'main',
      currentFile: i % 2 === 0 ? 'src/App.svelte' : 'src/components/Modal.svelte',
      wing: 'project-beta',
      room: 'ui',
      memoryId: 'mem_dark_mode_pref',
    });
  }

  // Mixed: occasionally the developer switches context unexpectedly
  // (simulates the "I need that old memory" scenario)
  sessions.push({
    projectPath: '/home/user/projects/alpha',
    gitBranch: 'feature/auth',
    currentFile: 'src/auth.ts',
    wing: 'project-alpha',
    room: 'auth',
    memoryId: 'mem_auth_jwt',
  });

  return sessions;
}

async function runBenchmark() {
  const store = new MemoryStore({ dbPath: ':memory:' });
  await store.init();

  const predictor = new IntentPredictor({
    confidenceThreshold: 0.3, // Lower threshold for benchmark (training data is small)
    maxPredictions: 3,
    minFrequency: 1,
  });

  // Seed memories
  const memories = [
    { id: 'mem_auth_jwt', content: 'Use JWT with 15min expiry and refresh tokens' },
    { id: 'mem_graphql_decision', content: 'GraphQL over REST for flexible queries' },
    { id: 'mem_dark_mode_pref', content: 'User prefers dark mode, system default fallback' },
  ];

  for (const mem of memories) {
    await store.store(mem.content, {
      wing: 'seed',
      room: 'seed',
      sourceId: mem.id,
    });
  }

  const sessions = generateWorkflow();
  let correctTop1 = 0;
  let correctTop3 = 0;
  let totalPredictions = 0;

  // Walk through sessions: train on past, predict for current
  for (let i = 1; i < sessions.length; i++) {
    const current = sessions[i]!;

    // Train on all previous sessions
    for (let j = 0; j < i; j++) {
      const past = sessions[j]!;
      const fp = buildFingerprint({
        projectPath: past.projectPath,
        gitBranch: past.gitBranch,
        currentFile: past.currentFile,
        recentTools: ['claude-code'],
        recentWings: [past.wing],
        recentRooms: [past.room],
      });
      predictor.recordAccess(fp, past.memoryId);
    }

    // Predict for current session
    const fp = buildFingerprint({
      projectPath: current.projectPath,
      gitBranch: current.gitBranch,
      currentFile: current.currentFile,
      recentTools: ['claude-code'],
      recentWings: [current.wing],
      recentRooms: [current.room],
    });

    const predictions = await predictor.predict(fp, async (id) => {
      const r = await store.get(id);
      return r.ok ? r.value : null;
    });

    if (!predictions.ok || predictions.value.length === 0) continue;

    totalPredictions++;
    const predictedIds = predictions.value.map(p => p.memoryId);

    if (predictedIds[0] === current.memoryId) {
      correctTop1++;
    }
    if (predictedIds.includes(current.memoryId)) {
      correctTop3++;
    }
  }

  store.close();

  console.log('\n========== PREDICTION BENCHMARK ==========');
  console.log(`Total test sessions:     ${sessions.length - 1}`);
  console.log(`Sessions with predictions: ${totalPredictions}`);
  console.log(`Top-1 accuracy:          ${(correctTop1 / (sessions.length - 1) * 100).toFixed(1)}%`);
  console.log(`Top-3 accuracy:          ${(correctTop3 / (sessions.length - 1) * 100).toFixed(1)}%`);
  console.log('==========================================');
}

runBenchmark().catch(console.error);
