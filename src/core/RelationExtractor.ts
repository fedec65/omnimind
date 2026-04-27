/**
 * RelationExtractor — Lightweight heuristic triple extraction
 *
 * Extracts subject-predicate-object relations from text using
 * regex patterns and co-occurrence heuristics. Zero LLM calls.
 *
 * Used by the AgingPipeline during L1 → L2 transition to
 * populate the knowledge graph.
 */

import { type Entity, type Relation } from './types.js';
import { randomUUID } from 'crypto';

/** Heuristic pattern for relation extraction */
interface RelationPattern {
  readonly pattern: RegExp;
  readonly predicate: string;
}

const RELATION_PATTERNS: RelationPattern[] = [
  { pattern: /(\w+)\s+uses?\s+(\w+)/gi, predicate: 'uses' },
  { pattern: /(\w+)\s+is\s+a[n]?\s+(\w+)/gi, predicate: 'is_a' },
  { pattern: /(\w+)\s+has\s+(\w+)/gi, predicate: 'has' },
  { pattern: /(\w+)\s+depends?\s+on\s+(\w+)/gi, predicate: 'depends_on' },
  { pattern: /(\w+)\s+connects?\s+(?:to|with)\s+(\w+)/gi, predicate: 'connects_to' },
  { pattern: /(\w+)\s+implements?\s+(\w+)/gi, predicate: 'implements' },
  { pattern: /(\w+)\s+extends?\s+(\w+)/gi, predicate: 'extends' },
  { pattern: /(\w+)\s+calls?\s+(\w+)/gi, predicate: 'calls' },
  { pattern: /(\w+)\s+returns?\s+(\w+)/gi, predicate: 'returns' },
  { pattern: /(\w+)\s+prefers?\s+(\w+)/gi, predicate: 'prefers' },
  { pattern: /(\w+)\s+requires?\s+(\w+)/gi, predicate: 'requires' },
  { pattern: /(\w+)\s+created?\s+(\w+)/gi, predicate: 'created' },
];

/**
 * Extract relations from text using heuristics.
 *
 * Two strategies:
 * 1. Pattern matching: scan for S-V-O structures like "X uses Y"
 * 2. Co-occurrence: link all entities that appear in the same text
 *
 * @param text — source text to analyze
 * @param entities — entities already extracted from the text (used for co-occurrence)
 * @param sourceMemory — optional memory ID to link relations back to source
 * @returns array of extracted relations
 */
export function extractRelations(
  text: string,
  entities: Entity[],
  sourceMemory?: string,
): Relation[] {
  const relations: Relation[] = [];
  const seen = new Set<string>();

  // Strategy 1: Pattern-based extraction
  for (const { pattern, predicate } of RELATION_PATTERNS) {
    let match: RegExpExecArray | null;
    // Reset lastIndex for global regex
    pattern.lastIndex = 0;
    while ((match = pattern.exec(text)) !== null) {
      const subjectName = match[1]!;
      const objectName = match[2]!;

      const subjectId = findEntityId(subjectName, entities);
      const objectId = findEntityId(objectName, entities);

      if (subjectId && objectId && subjectId !== objectId) {
        const key = `${subjectId}|${predicate}|${objectId}`;
        if (!seen.has(key)) {
          seen.add(key);
          relations.push({
            id: randomUUID(),
            subjectId,
            predicate,
            objectId,
            validFrom: Date.now(),
            validTo: null,
            sourceMemory: sourceMemory ?? null,
            confidence: 0.7,
          });
        }
      }
    }
  }

  // Strategy 2: Co-occurrence (every pair of entities in the same text is "related_to")
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const key = `${entities[i]!.id}|related_to|${entities[j]!.id}`;
      const reverseKey = `${entities[j]!.id}|related_to|${entities[i]!.id}`;
      if (!seen.has(key) && !seen.has(reverseKey)) {
        seen.add(key);
        relations.push({
          id: randomUUID(),
          subjectId: entities[i]!.id,
          predicate: 'related_to',
          objectId: entities[j]!.id,
          validFrom: Date.now(),
          validTo: null,
          sourceMemory: sourceMemory ?? null,
          confidence: 0.5,
        });
      }
    }
  }

  return relations;
}

/** Find an entity ID by name (case-insensitive) */
function findEntityId(name: string, entities: Entity[]): string | undefined {
  const lower = name.toLowerCase();
  const ent = entities.find(e =>
    e.name.toLowerCase() === lower ||
    e.name.toLowerCase().includes(lower) ||
    lower.includes(e.name.toLowerCase()),
  );
  return ent?.id;
}
