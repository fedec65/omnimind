/**
 * EntityExtractor — heuristic NER for concept extraction.
 *
 * Replaces the old inline regex in AgingPipeline with noise-resistant
 * rules, still 100% local and zero LLM calls:
 * - extended stoplist (discourse markers, sentence starters)
 * - sentence-initial discount (capitalized but lowercase elsewhere → not a proper noun)
 * - common-word shape filter
 * - canonicalization (TaskOutput ≡ task output ≡ taskoutput)
 *
 * The interface is stable so a future ONNX-based extractor can drop in.
 */

import { ENTITY_STOPWORDS, COMMON_WORDS } from './entityStopwords.js';

/** A single extracted entity candidate */
export interface ExtractedEntity {
  id: string;
  name: string;
  type: string;
}

const MAX_ENTITIES = 15;

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Normalize a surface form for canonical identity: lowercase, alphanumerics only. */
export function normalizeEntityName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Check whether a candidate name is plausible as an entity.
 * Applies stoplist/common-word filters on both the surface and the
 * normalized form, plus shape validation (no braces/quotes, must start
 * with a letter, `@` npm scope, or `/` path).
 */
const INVALID_NAME_CHARS = /[{}"']/;
const VALID_NAME_START = /^[A-Za-z@/]/;

export function isPlausibleEntity(name: string): boolean {
  if (name.length < 3 || name.length > 60) return false;
  if (INVALID_NAME_CHARS.test(name)) return false;
  if (!VALID_NAME_START.test(name)) return false;

  const lower = name.toLowerCase();
  if (ENTITY_STOPWORDS.has(lower)) return false;
  if (COMMON_WORDS.has(lower)) return false;

  // Also check the normalized form: ':false}' normalizes to 'false',
  // which is stoplisted even though the surface form is not.
  const normalized = normalizeEntityName(name);
  if (normalized.length < 3) return false;
  if (ENTITY_STOPWORDS.has(normalized)) return false;
  if (COMMON_WORDS.has(normalized)) return false;

  return true;
}

/**
 * Extract entities from text.
 *
 * Candidates: capitalized words/acronyms (GraphQL, MCP, TaskOutput) and
 * quoted strings. Filtered by stoplist, common words, and the
 * sentence-initial discount. Canonicalized so surface variants share one id.
 */
export function extractEntities(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  /** normalized form → index in entities */
  const byNormalized = new Map<string, number>();
  /** normalized form → surface form → occurrence count */
  const surfaceCounts = new Map<string, Map<string, number>>();

  const lowerText = text.toLowerCase();

  const addCandidate = (name: string, type: string): void => {
    if (!isPlausibleEntity(name)) return;
    const normalized = normalizeEntityName(name);
    if (normalized.length < 3) return;

    const existing = byNormalized.get(normalized);
    if (existing !== undefined) {
      // Track surface forms; the most frequent one wins as display name
      const counts = surfaceCounts.get(normalized)!;
      counts.set(name, (counts.get(name) ?? 0) + 1);
      let best = entities[existing]!.name;
      let bestCount = counts.get(best) ?? 0;
      for (const [form, count] of counts) {
        if (count > bestCount) {
          best = form;
          bestCount = count;
        }
      }
      entities[existing] = { ...entities[existing]!, name: best };
      return;
    }

    if (entities.length >= MAX_ENTITIES) return;
    byNormalized.set(normalized, entities.length);
    surfaceCounts.set(normalized, new Map([[name, 1]]));
    entities.push({
      id: `entity_${normalized}`,
      name,
      type,
    });
  };

  // Capitalized words (likely proper nouns), including camelCase and acronyms
  const properNounPattern = /\b[A-Z][a-z]+(?:[A-Z][a-z]+)*(?:[A-Z]{2,})?\b|\b[A-Z]{2,}\b/g;
  let match: RegExpExecArray | null;
  while ((match = properNounPattern.exec(text)) !== null) {
    const name = match[0];
    const lower = name.toLowerCase();

    // Sentence-initial discount: reject when the token is predominantly
    // lowercase in the text (lowercase-only occurrences outnumber the
    // capitalized ones). A casually lowercased mention does not kill a
    // real proper noun, but regular words capitalized by position are
    // filtered out.
    if (name !== lower) {
      const totalRe = new RegExp(`\\b${escapeRegExp(lower)}\\b`, 'g');
      const total = lowerText.match(totalRe)?.length ?? 0;
      const capRe = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'g');
      const capped = text.match(capRe)?.length ?? 0;
      if (total - capped > capped) continue;
    }

    addCandidate(name, inferEntityType(name, text));
  }

  // Quoted strings (likely important terms)
  const quotedPattern = /"([^"]+)"|'([^']+)'/g;
  while ((match = quotedPattern.exec(text)) !== null) {
    const name = match[1] ?? match[2];
    if (name && name.length <= 60) {
      addCandidate(name, 'concept');
    }
  }

  return entities;
}

/** Infer entity type from surrounding context */
export function inferEntityType(name: string, context: string): string {
  const lower = context.toLowerCase();
  const nameLower = name.toLowerCase();

  if (lower.includes(`class ${nameLower}`) || lower.includes(`interface ${nameLower}`)) return 'class';
  if (lower.includes(`function ${nameLower}`) || lower.includes(`def ${nameLower}`)) return 'function';
  if (lower.includes(`import ${nameLower}`) || lower.includes(`from ${nameLower}`)) return 'module';
  if (lower.includes(`api ${nameLower}`) || lower.includes(`${nameLower} endpoint`)) return 'api';
  if (lower.includes(`database ${nameLower}`) || lower.includes(`db ${nameLower}`)) return 'database';
  if (lower.includes(`service ${nameLower}`) || lower.includes(`${nameLower} service`)) return 'service';
  if (/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(name)) return 'person'; // "John Smith" pattern

  return 'concept';
}
