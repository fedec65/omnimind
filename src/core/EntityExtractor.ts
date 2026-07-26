/**
 * EntityExtractor — heuristic NER for concept extraction.
 *
 * 100% local, zero LLM calls, multi-language:
 * - per-language stopword packs (en/it/fr/de/es/pt), auto-detected
 * - sentence-initial discount (Latin scripts)
 * - surface+normalized plausibility checks
 * - Unicode-aware canonicalization (Société ≡ société, Müller ≡ müller)
 *
 * The interface is stable so a future ONNX-based extractor can drop in.
 */

import { type LanguagePack, getLanguagePack, mergePacks, SUPPORTED_LANGUAGES } from './ner/languagePack.js';
import { detectLanguage, type DetectedLanguage } from './ner/langDetection.js';

/** A single extracted entity candidate */
export interface ExtractedEntity {
  id: string;
  name: string;
  type: string;
}

export interface ExtractOptions {
  /**
   * Language of the text: 'auto' (default, detect), a language code
   * ('en', 'it', 'fr', 'de', 'es', 'pt'), or 'mixed' to merge all packs.
   */
  language?: string | undefined;
}

const MAX_ENTITIES = 15;

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Resolve the active language pack for a text + options */
function resolvePack(text: string, opts?: ExtractOptions): { pack: LanguagePack; detected: DetectedLanguage | string } {
  const requested = opts?.language ?? 'auto';
  if (requested === 'mixed' || requested === 'non-latin') {
    return { pack: mergePacks([...SUPPORTED_LANGUAGES]), detected: requested };
  }
  if (requested !== 'auto') {
    return { pack: getLanguagePack(requested), detected: requested };
  }
  const detected = detectLanguage(text);
  if (detected === 'mixed' || detected === 'non-latin') {
    return { pack: mergePacks([...SUPPORTED_LANGUAGES]), detected };
  }
  return { pack: getLanguagePack(detected), detected };
}

/** Normalize a surface form for canonical identity: lowercase, letters+digits only (Unicode-aware). */
export function normalizeEntityName(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Check whether a candidate name is plausible as an entity.
 * Applies stoplist/common-word filters on both the surface and the
 * normalized form, plus shape validation (no braces/quotes, must start
 * with a letter, `@` npm scope, or `/` path).
 */
const INVALID_NAME_CHARS = /[{}"']/;
const VALID_NAME_START = /^[\p{L}@/]/u;

export function isPlausibleEntity(name: string, pack: LanguagePack): boolean {
  if (name.length < 3 || name.length > 60) return false;
  if (INVALID_NAME_CHARS.test(name)) return false;
  if (!VALID_NAME_START.test(name)) return false;

  const lower = name.toLowerCase();
  if (pack.stopwords.has(lower)) return false;
  if (pack.commonWords.has(lower)) return false;

  // Also check the normalized form: ':false}' normalizes to 'false',
  // which is stoplisted even though the surface form is not.
  const normalized = normalizeEntityName(name);
  if (normalized.length < 3) return false;
  if (pack.stopwords.has(normalized)) return false;
  if (pack.commonWords.has(normalized)) return false;

  return true;
}

/**
 * Extract entities from text.
 *
 * Candidates: capitalized words/acronyms (GraphQL, MCP, TaskOutput) and
 * quoted strings. Filtered by the active language pack and the
 * sentence-initial discount. Canonicalized so surface variants share one id.
 */
export function extractEntities(text: string, opts?: ExtractOptions): ExtractedEntity[] {
  const { pack } = resolvePack(text, opts);
  const entities: ExtractedEntity[] = [];
  /** normalized form → index in entities */
  const byNormalized = new Map<string, number>();
  /** normalized form → surface form → occurrence count */
  const surfaceCounts = new Map<string, Map<string, number>>();

  const lowerText = text.toLowerCase();

  const addCandidate = (name: string, type: string): void => {
    if (!isPlausibleEntity(name, pack)) return;
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

  // Capitalized words (likely proper nouns), including camelCase and acronyms.
  // Matches Latin scripts with case; scripts without case simply yield no
  // candidates here (quoted strings below still work).
  const properNounPattern = /\b[\p{Lu}][\p{Ll}]+(?:[\p{Lu}][\p{Ll}]+)*(?:[\p{Lu}]{2,})?\b|\b[\p{Lu}]{2,}\b/gu;
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
      const totalRe = new RegExp(`\\b${escapeRegExp(lower)}\\b`, 'giu');
      const total = lowerText.match(totalRe)?.length ?? 0;
      const capRe = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'gu');
      const capped = text.match(capRe)?.length ?? 0;
      if (total - capped > capped) continue;
    }

    addCandidate(name, inferEntityType(name, text));
  }

  // Quoted strings (likely important terms) — language-agnostic
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
  if (/^[\p{Lu}][\p{Ll}]+ [\p{Lu}][\p{Ll}]+$/u.test(name)) return 'person'; // "John Smith" pattern

  return 'concept';
}
