/**
 * OnnxNerExtractor — multilingual NER via a local ONNX model.
 *
 * Uses Xenova/bert-base-multilingual-cased-ner-hrl (token-classification,
 * quantized int8, ~178MB) through @xenova/transformers. 100% local
 * inference, zero API calls. Covers 10 high-resource languages
 * (ar, de, en, es, fr, it, nl, pl, pt, ru, zh) — a superset of the
 * heuristic language packs.
 *
 * Model labels are mapped to Omnimind entity types (PER → person,
 * ORG → organization, LOC → location, MISC → concept) and the output is
 * canonicalized through the same normalizeEntityName / isPlausibleEntity
 * rules as the heuristic extractor, so entity ids (entity_<normalized>)
 * merge cleanly in the knowledge graph regardless of the engine used.
 */

import { pipeline } from '@xenova/transformers';
import { type Result, ok, err } from '../types.js';
import {
  type ExtractedEntity,
  type ExtractOptions,
  isPlausibleEntity,
  normalizeEntityName,
  resolvePack,
} from '../EntityExtractor.js';

const MODEL_NAME = 'Xenova/bert-base-multilingual-cased-ner-hrl';
const MAX_ENTITIES = 15;
/** Spans whose average token score is below this are discarded as noise */
const MIN_AVG_SCORE = 0.5;

/** CoNLL label → Omnimind entity type */
const LABEL_MAP: Record<string, string> = {
  PER: 'person',
  ORG: 'organization',
  LOC: 'location',
  MISC: 'concept',
};

/** A single token emitted by the token-classification pipeline */
export interface NerToken {
  entity: string;
  score: number;
  word: string;
  start?: number | null | undefined;
  end?: number | null | undefined;
}

export type TokenClassifier = (text: string) => Promise<NerToken[]>;

interface Span {
  type: string;
  start: number | null;
  end: number | null;
  words: string[];
  scoreSum: number;
  tokenCount: number;
}

/** Group B-/I- tagged tokens into entity spans */
function groupSpans(tokens: NerToken[]): Span[] {
  const spans: Span[] = [];
  let current: Span | null = null;

  for (const tok of tokens) {
    const labelMatch = /^(?:B-|I-)?([A-Z]+)$/.exec(tok.entity);
    if (!labelMatch) continue;
    const type = LABEL_MAP[labelMatch[1]!];
    if (!type) continue;

    if (tok.entity.startsWith('B-') || current === null || current.type !== type) {
      if (current) spans.push(current);
      current = {
        type,
        start: tok.start ?? null,
        end: tok.end ?? null,
        words: [tok.word],
        scoreSum: tok.score,
        tokenCount: 1,
      };
    } else {
      if (tok.end != null) current.end = tok.end;
      current.words.push(tok.word);
      current.scoreSum += tok.score;
      current.tokenCount++;
    }
  }
  if (current) spans.push(current);
  return spans;
}

/** Recover the surface form of a span: char offsets when available, subword join otherwise */
function spanText(span: Span, text: string): string {
  if (span.start !== null && span.end !== null && span.end > span.start) {
    return text.slice(span.start, span.end);
  }
  // Fallback: join subwords — WordPiece '##' continues the previous word,
  // SentencePiece '▁' marks a word boundary.
  const joined = span.words
    .map((w) => w.replace(/▁/g, ' '))
    .map((w) => (w.startsWith('##') ? w.slice(2) : ` ${w}`))
    .join('');
  return joined.replace(/\s+/g, ' ').trim();
}

/** Strip punctuation the model may include at span edges */
const EDGE_PUNCT = /^[\s.,;:!?'"()[\]]+|[\s.,;:!?'"()[\]]+$/g;

export class OnnxNerExtractor {
  private classifier: TokenClassifier | null;

  /**
   * @param classifier optional pre-built classifier (used to inject fakes in tests;
   * when omitted, init() loads the real ONNX pipeline)
   */
  constructor(classifier?: TokenClassifier) {
    this.classifier = classifier ?? null;
  }

  /** Load the ONNX model (downloads ~178MB on first run) */
  async init(): Promise<Result<void>> {
    try {
      this.classifier = (await pipeline('token-classification', MODEL_NAME, {
        quantized: true,
      })) as unknown as TokenClassifier;
      console.log(`[OnnxNerExtractor] Loaded ${MODEL_NAME}`);
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  get ready(): boolean {
    return this.classifier !== null;
  }

  /**
   * Extract entities from text with the ONNX model.
   * Results are filtered by the language pack, canonicalized, and deduped
   * exactly like the heuristic extractor's output.
   */
  async extract(text: string, opts?: ExtractOptions): Promise<Result<ExtractedEntity[]>> {
    if (!this.classifier) {
      return err(new Error('OnnxNerExtractor not initialized'));
    }

    try {
      const trimmed = text.trim();
      if (!trimmed) return ok([]);

      const tokens = await this.classifier(trimmed);
      const { pack } = resolvePack(trimmed, opts);

      const entities: ExtractedEntity[] = [];
      /** normalized form → index in entities */
      const byNormalized = new Map<string, number>();
      /** normalized form → surface form → occurrence count */
      const surfaceCounts = new Map<string, Map<string, number>>();

      for (const span of groupSpans(tokens)) {
        if (span.scoreSum / span.tokenCount < MIN_AVG_SCORE) continue;
        const name = spanText(span, trimmed).replace(EDGE_PUNCT, '').trim();
        if (!isPlausibleEntity(name, pack)) continue;

        const normalized = normalizeEntityName(name);
        if (normalized.length < 3) continue;

        const existing = byNormalized.get(normalized);
        if (existing !== undefined) {
          // Most frequent surface form wins as display name
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
          continue;
        }

        if (entities.length >= MAX_ENTITIES) continue;
        byNormalized.set(normalized, entities.length);
        surfaceCounts.set(normalized, new Map([[name, 1]]));
        entities.push({ id: `entity_${normalized}`, name, type: span.type });
      }

      return ok(entities);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
