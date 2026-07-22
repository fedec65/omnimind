/**
 * Graph rebuild integration test
 *
 * rebuildGraph() must wipe and re-derive the knowledge graph:
 * - L0/L1 memories: re-extract from full text with the current NER
 * - L2 memories: re-parse legacy `[Concept: ...]` summaries, filtering
 *   noise (Let/Now/...) through the new plausibility rules
 * The result must be coherent: every relation endpoint exists in entities.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Omnimind } from '../../src/index.js';
import { rebuildGraph } from '../../src/core/GraphRebuilder.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('Graph rebuild', () => {
  let omni: Omnimind;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omnimind-rebuild-'));
    omni = await Omnimind.create({ dataDir: tmpDir, adapters: false });
  });

  afterEach(() => {
    omni.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rebuilds a clean, coherent graph from L0 text and legacy L2 summaries', async () => {
    // L0 memory with noisy discourse words + real entities
    const store1 = await omni.store('Let me note: TaskOutput uses Redis for caching. Perfect.', { wing: 'test' });
    expect(store1.ok).toBe(true);

    // L2 memory carrying a legacy noisy concept summary (original text lost,
    // as happens after aging) — noise must be filtered on rebuild
    const store2 = await omni.store('placeholder content', { wing: 'test' });
    expect(store2.ok).toBe(true);
    if (!store2.ok) return;
    const upd = await omni.memoryStore.update(store2.value.id, {
      content: '[Concept: Let(concept), Now(concept), TaskOutput(concept)]',
      layer: 2,
      conceptRefs: ['entity_let', 'entity_now', 'entity_taskoutput'],
    });
    expect(upd.ok).toBe(true);

    const result = await rebuildGraph(omni.memoryStore);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const report = result.value;
    expect(report.memoriesProcessed).toBeGreaterThan(0);

    const entities = omni.getEntities({ limit: 1000 });
    expect(entities.ok).toBe(true);
    if (!entities.ok) return;
    const ids = new Set(entities.value.map((e) => e.id));

    // Real entities survive, noise is gone
    expect(ids.has('entity_taskoutput')).toBe(true);
    expect(ids.has('entity_redis')).toBe(true);
    expect(ids.has('entity_let')).toBe(false);
    expect(ids.has('entity_now')).toBe(false);

    // Coherence: every relation endpoint exists in entities
    const relations = omni.getRelations({ limit: 1000 });
    expect(relations.ok).toBe(true);
    if (!relations.ok) return;
    for (const r of relations.value) {
      expect(ids.has(r.subjectId)).toBe(true);
      expect(ids.has(r.objectId)).toBe(true);
    }

    // Verb relation from the L0 text is re-extracted
    const uses = relations.value.find((r) => r.predicate === 'uses');
    expect(uses).toBeDefined();
    expect(uses!.subjectId).toBe('entity_taskoutput');
    expect(uses!.objectId).toBe('entity_redis');
  });

  it('is idempotent — a second rebuild converges to the same graph size', async () => {
    const s = await omni.store('GraphQL is used by the API gateway.', { wing: 'test' });
    expect(s.ok).toBe(true);

    const first = await rebuildGraph(omni.memoryStore);
    const second = await rebuildGraph(omni.memoryStore);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.value.entitiesAfter).toBe(first.value.entitiesAfter);
    expect(second.value.relationsAfter).toBe(first.value.relationsAfter);
  });
});
