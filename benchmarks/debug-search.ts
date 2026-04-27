import { join } from 'path';
import { Omnimind } from '../src/index.js';

async function main() {
  const omni = await Omnimind.create({ dataDir: join(import.meta.dirname, '.debug'), dbName: 'debug.db' });

  await omni.store('The farmer needs to transport a fox, a chicken, and some grain across a river.', {
    wing: 'test', room: 'test', sourceTool: 'test', sourceId: 'session_a',
  });
  await omni.store('I graduated with a Business Administration degree from Stanford in 2020.', {
    wing: 'test', room: 'test', sourceTool: 'test', sourceId: 'session_b',
  });

  const results = await omni.search('What degree did I graduate with?', { limit: 5 });
  console.log('Search ok:', results.ok);
  if (results.ok) {
    console.log('Results count:', results.value.length);
    for (const r of results.value) {
      console.log('  score:', r.score, 'sourceId:', r.memory.sourceId, 'content:', r.memory.content.substring(0, 80));
    }
  } else {
    console.log('Search error:', results.error.message);
  }

  omni.close();
}

main().catch(console.error);
