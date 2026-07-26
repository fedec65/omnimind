/**
 * GraphRebuilder — wipe and re-derive the knowledge graph from memories.
 *
 * Used by `omnimind rebuild-graph` after the entity extractor improves
 * (e.g. better NER). Strategy per layer:
 * - L0/L1: full original text is available → re-extract entities and
 *   relations with the current extractor.
 * - L2: original text was overwritten by the `[Concept: ...]` summary →
 *   re-parse the summaries, filter names through the new plausibility
 *   rules, canonicalize, and re-link by co-occurrence.
 */

import { type MemoryStore } from './MemoryStore.js';
import { type Memory, type Entity, type EntityType, type Result, MemoryLayer, ok, err } from './types.js';
import { extractEntities, isPlausibleEntity, normalizeEntityName } from './EntityExtractor.js';
import { configureNerEngine, extractEntitiesAsync, initNerEngine, type NerEngineKind } from './ner/NerEngine.js';
import { extractRelations } from './RelationExtractor.js';
import { mergePacks, SUPPORTED_LANGUAGES } from './ner/languagePack.js';

/** Rebuilds filter with the union of all language packs — the corpus may be multilingual */
const REBUILD_PACK = mergePacks([...SUPPORTED_LANGUAGES]);

export interface RebuildOptions {
  /**
   * NER engine for re-extracting entities from L0/L1 full text.
   * 'heuristic' (default) or 'onnx' (multilingual model, loaded on demand
   * with automatic fallback to heuristic if unavailable).
   */
  ner?: NerEngineKind | undefined;
}

export interface RebuildReport {
  entitiesBefore: number;
  relationsBefore: number;
  entitiesAfter: number;
  relationsAfter: number;
  memoriesProcessed: number;
  memoriesSkipped: number;
  topEntities: Array<{ name: string; type: string; mentionCount: number }>;
}

/** Parse `[Concept: Name(type), Name(type)...]` summaries back into entity candidates */
function parseConceptSummary(content: string): Array<{ name: string; type: string }> {
  const match = /^\[Concept: (.*)\]$/.exec(content.trim());
  if (!match) return [];
  const entities: Array<{ name: string; type: string }> = [];
  const pattern = /([^(),]+)\((\w+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(match[1]!)) !== null) {
    entities.push({ name: m[1]!.trim(), type: m[2]! });
  }
  return entities;
}

/**
 * Wipe and rebuild the knowledge graph. The store must be initialized.
 */
export async function rebuildGraph(store: MemoryStore, opts?: RebuildOptions): Promise<Result<RebuildReport>> {
  try {
    if (opts?.ner === 'onnx') {
      configureNerEngine('onnx');
      await initNerEngine(); // falls back to heuristic if the model is unavailable
    }
    const useAsyncNer = opts?.ner === 'onnx';

    const entBefore = store.queryEntities({ limit: 1_000_000 });
    const relBefore = store.queryRelations({ limit: 1_000_000 });
    const entitiesBefore = entBefore.ok ? entBefore.value.length : 0;
    const relationsBefore = relBefore.ok ? relBefore.value.length : 0;

    const cleared = store.clearGraph();
    if (!cleared.ok) return err(cleared.error);

    const ids = store.getAllMemoryIds();
    if (!ids.ok) return err(ids.error);

    let processed = 0;
    let skipped = 0;

    for (const id of ids.value) {
      const got = await store.get(id);
      if (!got.ok || !got.value) {
        skipped++;
        continue;
      }
      const memory: Memory = got.value;

      // Pinned or empty memories contribute nothing
      if (!memory.content) {
        skipped++;
        continue;
      }

      let entities: Entity[];

      if (memory.layer === MemoryLayer.Concept || memory.layer === MemoryLayer.Wisdom) {
        // Original text lost — re-parse the concept summary
        const parsed = parseConceptSummary(memory.content)
          .filter((e) => isPlausibleEntity(e.name, REBUILD_PACK))
          .filter((e) => normalizeEntityName(e.name).length >= 3);
        // Canonicalize: one entity per normalized form
        const seen = new Set<string>();
        entities = [];
        for (const p of parsed) {
          const normalized = normalizeEntityName(p.name);
          if (seen.has(normalized)) continue;
          seen.add(normalized);
          entities.push({
            id: `entity_${normalized}`,
            name: p.name,
            type: p.type as EntityType,
            description: null,
            firstSeen: memory.createdAt,
            lastSeen: memory.createdAt,
            mentionCount: 1,
          });
        }
      } else {
        // Full text available — re-extract with the current NER
        const extracted = useAsyncNer
          ? await extractEntitiesAsync(memory.content)
          : extractEntities(memory.content);
        entities = extracted.map((e) => ({
          id: e.id,
          name: e.name,
          type: e.type as EntityType,
          description: null,
          firstSeen: memory.createdAt,
          lastSeen: memory.createdAt,
          mentionCount: 1,
        }));
        if (entities.length === 0) {
          skipped++;
          continue;
        }
      }

      if (entities.length === 0) {
        skipped++;
        continue;
      }

      for (const entity of entities) {
        store.upsertEntity(entity);
      }

      // Relations: for L0/L1 run the full extractor on the original text;
      // for L2/L3 derive co-occurrence from the summary's entity set.
      const relations =
        memory.layer <= MemoryLayer.Compressed
          ? extractRelations(memory.content, entities, memory.id)
          : extractRelations(entities.map((e) => e.name).join(' and '), entities, memory.id);

      for (const relation of relations) {
        store.insertRelation(relation);
      }

      processed++;
    }

    const entAfter = store.queryEntities({ limit: 1_000_000 });
    const relAfter = store.queryRelations({ limit: 1_000_000 });

    const top = (entAfter.ok ? entAfter.value : [])
      .slice()
      .sort((a, b) => b.mentionCount - a.mentionCount)
      .slice(0, 10)
      .map((e) => ({ name: e.name, type: e.type, mentionCount: e.mentionCount }));

    return ok({
      entitiesBefore,
      relationsBefore,
      entitiesAfter: entAfter.ok ? entAfter.value.length : 0,
      relationsAfter: relAfter.ok ? relAfter.value.length : 0,
      memoriesProcessed: processed,
      memoriesSkipped: skipped,
      topEntities: top,
    });
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
