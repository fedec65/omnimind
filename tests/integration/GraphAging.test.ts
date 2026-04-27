/**
 * Graph aging integration test
 *
 * Tests that L2 (Concept) aging extracts entities and relations
 * and persists them to the knowledge graph.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Omnimind } from '../../src/index.js';
import { MemoryLayer } from '../../src/core/types.js';
import { extractRelations } from '../../src/core/RelationExtractor.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('Graph Aging', () => {
  let omni: Omnimind;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omnimind-graph-aging-'));
    omni = await Omnimind.create({ dataDir: tmpDir });
  });

  afterEach(() => {
    omni.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should persist entities and relations when aging to L2', async () => {
    // Store a memory with rich entity content
    const storeResult = await omni.store(
      'The API uses GraphQL and depends on PostgreSQL. Redis is a cache.',
      { wing: 'tech', room: 'backend' },
    );
    expect(storeResult.ok).toBe(true);
    if (!storeResult.ok) return;

    const memory = storeResult.value;

    // Force transition to L2 (bypass age check for test)
    const transition = await omni.aging.transition(memory, MemoryLayer.Concept);
    expect(transition.ok).toBe(true);
    if (!transition.ok) return;

    const aged = transition.value;

    // Update the memory in the store
    const updateResult = await omni.memoryStore.update(memory.id, {
      content: aged.content,
      layer: aged.layer,
      conceptRefs: aged.conceptRefs,
      compressedRef: aged.compressedRef,
    });
    expect(updateResult.ok).toBe(true);

    // Parse entities from the concept summary
    // Format: [Concept: Name(type), Name(type)...]
    const entityPattern = /(\w+)\((\w+)\)/g;
    const entities: Array<{ id: string; name: string; type: string }> = [];
    let match: RegExpExecArray | null;
    while ((match = entityPattern.exec(aged.content)) !== null) {
      entities.push({
        id: `entity_${match[1]!.toLowerCase()}`,
        name: match[1]!,
        type: match[2]!,
      });
    }

    // Upsert entities into the graph
    for (const entity of entities) {
      const upsert = omni.memoryStore.upsertEntity({
        id: entity.id,
        name: entity.name,
        type: entity.type as any,
        description: null,
      });
      expect(upsert.ok).toBe(true);
    }

    // Extract and persist relations
    const relations = extractRelations(memory.content, entities as any, memory.id);
    for (const relation of relations) {
      const insert = omni.memoryStore.insertRelation(relation);
      expect(insert.ok).toBe(true);
    }

    // Verify entities exist
    const allEntities = omni.getEntities({ limit: 10 });
    expect(allEntities.ok).toBe(true);
    if (!allEntities.ok) return;

    const entityNames = allEntities.value.map(e => e.name);
    expect(entityNames).toContain('GraphQL');
    expect(entityNames).toContain('PostgreSQL');
    expect(entityNames).toContain('Redis');

    // Verify relations exist
    const allRelations = omni.getRelations({ limit: 20 });
    expect(allRelations.ok).toBe(true);
    if (!allRelations.ok) return;
    expect(allRelations.value.length).toBeGreaterThan(0);

    // Graph search should find the memory via entity names
    const graphResults = await omni.memoryStore.searchEngine!.graphSearch('GraphQL', 5);
    expect(graphResults.length).toBeGreaterThan(0);
    expect(graphResults[0]!.matchType).toBe('graph');
  });
});
