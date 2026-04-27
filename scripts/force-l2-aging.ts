#!/usr/bin/env node
/**
 * Force L2 (Concept) aging on existing L0 memories.
 *
 * This script bypasses the 30-day threshold to immediately populate
 * the Concept Graph with entities and relations.
 *
 * Usage:
 *   npx tsx scripts/force-l2-aging.ts [count]
 *
 * Default count: 50 memories
 */

import { Omnimind } from '../src/index.js';
import { MemoryLayer, type Memory, type Entity, type EntityType } from '../src/core/types.js';
import { extractRelations } from '../src/core/RelationExtractor.js';

const DEFAULT_COUNT = 50;
const count = parseInt(process.argv[2] ?? String(DEFAULT_COUNT), 10);

async function main(): Promise<void> {
  console.log(`[ForceL2] Initializing Omnimind...`);
  const omni = await Omnimind.create();

  // Query L0 memories from claude-code namespace, preferring richer content
  console.log(`[ForceL2] Selecting ${count} candidate memories...`);
  const searchResult = await omni.search('', {
    limit: count * 2,
    layer: MemoryLayer.Verbatim,
    namespace: 'claude-code',
  });

  if (!searchResult.ok) {
    console.error('[ForceL2] Failed to query memories:', searchResult.error.message);
    process.exit(1);
  }

  // Sort by content length descending (longer = richer entity potential)
  const candidates = searchResult.value
    .map((r) => r.memory)
    .sort((a, b) => b.content.length - a.content.length)
    .slice(0, count);

  if (candidates.length === 0) {
    console.log('[ForceL2] No L0 memories found.');
    process.exit(0);
  }

  console.log(`[ForceL2] Processing ${candidates.length} memories...`);

  let processed = 0;
  let skipped = 0;
  let entitiesCreated = 0;
  let relationsCreated = 0;

  for (const memory of candidates) {
    try {
      // Step 1: Force transition to L2 (bypass age check)
      const transition = await omni.aging.transition(memory, MemoryLayer.Concept);
      if (!transition.ok) {
        console.warn(`[ForceL2] Transition failed for ${memory.id}:`, transition.error.message);
        skipped++;
        continue;
      }

      const aged = transition.value;

      // Step 2: Update memory in store
      const updateResult = await omni.memoryStore.update(memory.id, {
        content: aged.content,
        layer: aged.layer,
        conceptRefs: aged.conceptRefs,
        compressedRef: aged.compressedRef,
      });
      if (!updateResult.ok) {
        console.warn(`[ForceL2] Update failed for ${memory.id}:`, updateResult.error.message);
        skipped++;
        continue;
      }

      // Step 3: Parse entities from concept summary
      // Format: [Concept: Name(type), Name(type)...]
      const entityPattern = /(\w+)\((\w+)\)/g;
      const entities: Entity[] = [];
      let match: RegExpExecArray | null;
      while ((match = entityPattern.exec(aged.content)) !== null) {
        const name = match[1]!;
        const type = match[2]!;
        const id = `entity_${name.toLowerCase()}`;
        entities.push({
          id,
          name,
          type: type as EntityType,
          description: null,
          firstSeen: Date.now(),
          lastSeen: Date.now(),
          mentionCount: 1,
        });
      }

      // Step 4: Upsert entities
      for (const entity of entities) {
        const upsert = omni.memoryStore.upsertEntity(entity);
        if (!upsert.ok) {
          console.warn(`[ForceL2] Failed to upsert entity ${entity.id}:`, upsert.error.message);
        } else {
          entitiesCreated++;
        }
      }

      // Step 5: Extract and persist relations
      const relations = extractRelations(memory.content, entities, memory.id);
      for (const relation of relations) {
        const insert = omni.memoryStore.insertRelation(relation);
        if (!insert.ok) {
          console.warn(`[ForceL2] Failed to insert relation:`, insert.error.message);
        } else {
          relationsCreated++;
        }
      }

      processed++;
      if (processed % 10 === 0) {
        console.log(`[ForceL2] ... ${processed} done, ${entitiesCreated} entities, ${relationsCreated} relations`);
      }
    } catch (err) {
      console.warn(`[ForceL2] Exception processing ${memory.id}:`, err);
      skipped++;
    }
  }

  console.log('\n[ForceL2] Done!');
  console.log(`  Memories processed: ${processed}`);
  console.log(`  Memories skipped:   ${skipped}`);
  console.log(`  Entities created:   ${entitiesCreated}`);
  console.log(`  Relations created:  ${relationsCreated}`);

  omni.close();
}

main().catch((err) => {
  console.error('[ForceL2] Fatal error:', err);
  process.exit(1);
});
