/**
 * RelationExtractor — Lightweight heuristic triple extraction
 *
 * Extracts subject-predicate-object relations from text using
 * regex patterns and co-occurrence heuristics. Zero LLM calls.
 *
 * Verb patterns exist per language (en/it/fr/de/es/pt) but predicates
 * stay canonical English (uses, depends_on, ...) so the knowledge graph
 * remains language-neutral.
 *
 * Used by the AgingPipeline during L1 → L2 transition to
 * populate the knowledge graph.
 */

import { type Entity, type Relation } from './types.js';
import { randomUUID } from 'crypto';
import { detectLanguage } from './ner/langDetection.js';

/** Heuristic pattern for relation extraction */
interface RelationPattern {
  readonly pattern: RegExp;
  readonly predicate: string;
}

const EN_PATTERNS: RelationPattern[] = [
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

const IT_PATTERNS: RelationPattern[] = [
  { pattern: /(\w+)\s+usa[n]?\s+(\w+)/gi, predicate: 'uses' },
  { pattern: /(\w+)\s+è\s+un[a]?\s+(\w+)/gi, predicate: 'is_a' },
  { pattern: /(\w+)\s+ha\s+(\w+)/gi, predicate: 'has' },
  { pattern: /(\w+)\s+dipende\s+da\s+(\w+)/gi, predicate: 'depends_on' },
  { pattern: /(\w+)\s+richiede\s+(\w+)/gi, predicate: 'requires' },
  { pattern: /(\w+)\s+implementa\s+(\w+)/gi, predicate: 'implements' },
  { pattern: /(\w+)\s+estende\s+(\w+)/gi, predicate: 'extends' },
  { pattern: /(\w+)\s+chiama\s+(\w+)/gi, predicate: 'calls' },
  { pattern: /(\w+)\s+restituisce\s+(\w+)/gi, predicate: 'returns' },
  { pattern: /(\w+)\s+preferisce\s+(\w+)/gi, predicate: 'prefers' },
];

const FR_PATTERNS: RelationPattern[] = [
  { pattern: /(\w+)\s+utilise\s+(\w+)/gi, predicate: 'uses' },
  { pattern: /(\w+)\s+est\s+un[e]?\s+(\w+)/gi, predicate: 'is_a' },
  { pattern: /(\w+)\s+a\s+(\w+)/gi, predicate: 'has' },
  { pattern: /(\w+)\s+dépend\s+de\s+(\w+)/gi, predicate: 'depends_on' },
  { pattern: /(\w+)\s+requiert\s+(\w+)/gi, predicate: 'requires' },
  { pattern: /(\w+)\s+implémente\s+(\w+)/gi, predicate: 'implements' },
  { pattern: /(\w+)\s+retourne\s+(\w+)/gi, predicate: 'returns' },
  { pattern: /(\w+)\s+préfère\s+(\w+)/gi, predicate: 'prefers' },
];

const DE_PATTERNS: RelationPattern[] = [
  { pattern: /(\w+)\s+(?:verwendet|nutzt|benutzt)\s+(\w+)/gi, predicate: 'uses' },
  { pattern: /(\w+)\s+ist\s+(?:ein|eine|kein)\s+(\w+)/gi, predicate: 'is_a' },
  { pattern: /(\w+)\s+hat\s+(\w+)/gi, predicate: 'has' },
  { pattern: /(\w+)\s+hängt\s+ab\s+von\s+(\w+)/gi, predicate: 'depends_on' },
  { pattern: /(\w+)\s+(?:erfordert|benötigt)\s+(\w+)/gi, predicate: 'requires' },
  { pattern: /(\w+)\s+implementiert\s+(\w+)/gi, predicate: 'implements' },
  { pattern: /(\w+)\s+gibt\s+(\w+)\s+zurück/gi, predicate: 'returns' },
  { pattern: /(\w+)\s+bevorzugt\s+(\w+)/gi, predicate: 'prefers' },
];

const ES_PATTERNS: RelationPattern[] = [
  { pattern: /(\w+)\s+usa\s+(\w+)/gi, predicate: 'uses' },
  { pattern: /(\w+)\s+es\s+un[a]?\s+(\w+)/gi, predicate: 'is_a' },
  { pattern: /(\w+)\s+tiene\s+(\w+)/gi, predicate: 'has' },
  { pattern: /(\w+)\s+depende\s+de\s+(\w+)/gi, predicate: 'depends_on' },
  { pattern: /(\w+)\s+requiere\s+(\w+)/gi, predicate: 'requires' },
  { pattern: /(\w+)\s+implementa\s+(\w+)/gi, predicate: 'implements' },
  { pattern: /(\w+)\s+devuelve\s+(\w+)/gi, predicate: 'returns' },
  { pattern: /(\w+)\s+prefiere\s+(\w+)/gi, predicate: 'prefers' },
];

const PT_PATTERNS: RelationPattern[] = [
  { pattern: /(\w+)\s+usa\s+(\w+)/gi, predicate: 'uses' },
  { pattern: /(\w+)\s+é\s+um[a]?\s+(\w+)/gi, predicate: 'is_a' },
  { pattern: /(\w+)\s+tem\s+(\w+)/gi, predicate: 'has' },
  { pattern: /(\w+)\s+depende\s+de\s+(\w+)/gi, predicate: 'depends_on' },
  { pattern: /(\w+)\s+requer\s+(\w+)/gi, predicate: 'requires' },
  { pattern: /(\w+)\s+implementa\s+(\w+)/gi, predicate: 'implements' },
  { pattern: /(\w+)\s+retorna\s+(\w+)/gi, predicate: 'returns' },
  { pattern: /(\w+)\s+prefere\s+(\w+)/gi, predicate: 'prefers' },
];

const PATTERNS_BY_LANGUAGE: Record<string, RelationPattern[]> = {
  en: EN_PATTERNS,
  it: IT_PATTERNS,
  fr: FR_PATTERNS,
  de: DE_PATTERNS,
  es: ES_PATTERNS,
  pt: PT_PATTERNS,
};

/** Co-occurrence links are only drawn among the first N entities of a text */
const COOCCURRENCE_ENTITY_LIMIT = 7;
/** Hard cap on relations extracted from a single text */
const MAX_RELATIONS_PER_TEXT = 30;

function resolvePatterns(text: string, language?: string): RelationPattern[] {
  const requested = language ?? 'auto';
  if (requested === 'mixed' || requested === 'non-latin') {
    return Object.values(PATTERNS_BY_LANGUAGE).flat();
  }
  if (requested !== 'auto') {
    return PATTERNS_BY_LANGUAGE[requested] ?? EN_PATTERNS;
  }
  const detected = detectLanguage(text);
  if (detected === 'mixed' || detected === 'non-latin') {
    return Object.values(PATTERNS_BY_LANGUAGE).flat();
  }
  return PATTERNS_BY_LANGUAGE[detected] ?? EN_PATTERNS;
}

/**
 * Extract relations from text using heuristics.
 *
 * Two strategies:
 * 1. Pattern matching: scan for S-V-O structures like "X uses Y"
 * 2. Co-occurrence: link entities that appear in the same text (dampened)
 *
 * @param text — source text to analyze
 * @param entities — entities already extracted from the text (used for co-occurrence)
 * @param sourceMemory — optional memory ID to link relations back to source
 * @param opts — optional language override ('auto' default)
 * @returns array of extracted relations
 */
export function extractRelations(
  text: string,
  entities: Entity[],
  sourceMemory?: string,
  opts?: { language?: string },
): Relation[] {
  const relations: Relation[] = [];
  const seen = new Set<string>();
  const patterns = resolvePatterns(text, opts?.language);

  // Strategy 1: Pattern-based extraction
  for (const { pattern, predicate } of patterns) {
    let match: RegExpExecArray | null;
    // Reset lastIndex for global regex
    pattern.lastIndex = 0;
    while ((match = pattern.exec(text)) !== null) {
      if (relations.length >= MAX_RELATIONS_PER_TEXT) return relations;
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

  // Strategy 2: Co-occurrence — entities appearing in the same text are
  // "related_to". Dampened to fight combinatorial noise: only among the
  // first COOCCURRENCE_ENTITY_LIMIT entities, never for pairs that already
  // have a verb relation, and subject to the per-text cap.
  const cooccurrenceEntities = entities.slice(0, COOCCURRENCE_ENTITY_LIMIT);
  for (let i = 0; i < cooccurrenceEntities.length; i++) {
    for (let j = i + 1; j < cooccurrenceEntities.length; j++) {
      if (relations.length >= MAX_RELATIONS_PER_TEXT) return relations;
      const key = `${cooccurrenceEntities[i]!.id}|related_to|${cooccurrenceEntities[j]!.id}`;
      const reverseKey = `${cooccurrenceEntities[j]!.id}|related_to|${cooccurrenceEntities[i]!.id}`;
      // Skip pairs already linked by a verb relation (any predicate, either direction)
      const pairLinked = [...seen].some(
        (k) =>
          (k.startsWith(`${cooccurrenceEntities[i]!.id}|`) && k.endsWith(`|${cooccurrenceEntities[j]!.id}`)) ||
          (k.startsWith(`${cooccurrenceEntities[j]!.id}|`) && k.endsWith(`|${cooccurrenceEntities[i]!.id}`)),
      );
      if (!seen.has(key) && !seen.has(reverseKey) && !pairLinked) {
        seen.add(key);
        relations.push({
          id: randomUUID(),
          subjectId: cooccurrenceEntities[i]!.id,
          predicate: 'related_to',
          objectId: cooccurrenceEntities[j]!.id,
          validFrom: Date.now(),
          validTo: null,
          sourceMemory: sourceMemory ?? null,
          confidence: 0.5,
        });
      }
    }
  }

  return relations.slice(0, MAX_RELATIONS_PER_TEXT);
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
