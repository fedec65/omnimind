/**
 * OnnxNerExtractor tests — span grouping, label mapping, canonicalization.
 *
 * The ONNX pipeline is never loaded here: a fake TokenClassifier is
 * injected, so tests are fast and offline.
 */

import { describe, it, expect } from 'vitest';
import { OnnxNerExtractor, type NerToken } from '../../../src/core/ner/OnnxNerExtractor.js';

const TEXT = 'Mario Rossi signed the contract with Acme Corporation in Milan.';

const BASIC_TOKENS: NerToken[] = [
  { entity: 'B-PER', score: 0.99, word: 'Mario', start: 0, end: 5 },
  { entity: 'I-PER', score: 0.98, word: 'Rossi', start: 6, end: 11 },
  { entity: 'B-ORG', score: 0.97, word: 'Acme', start: 37, end: 41 },
  { entity: 'I-ORG', score: 0.96, word: 'Corporation', start: 42, end: 53 },
  { entity: 'B-LOC', score: 0.95, word: 'Milan', start: 57, end: 62 },
];

const fakeClassifier = (tokens: NerToken[]) => async (): Promise<NerToken[]> => tokens;

describe('OnnxNerExtractor', () => {
  it('fails when not initialized', async () => {
    const extractor = new OnnxNerExtractor();
    const result = await extractor.extract(TEXT);
    expect(result.ok).toBe(false);
  });

  it('groups B-/I- spans and maps labels to entity types', async () => {
    const extractor = new OnnxNerExtractor(fakeClassifier(BASIC_TOKENS));
    const result = await extractor.extract(TEXT, { language: 'en' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const byName = new Map(result.value.map((e) => [e.name, e]));
    expect(byName.get('Mario Rossi')?.type).toBe('person');
    expect(byName.get('Mario Rossi')?.id).toBe('entity_mariorossi');
    expect(byName.get('Acme Corporation')?.type).toBe('organization');
    expect(byName.get('Milan')?.type).toBe('location');
  });

  it('starts a new span when the label changes without a B- prefix', async () => {
    const tokens: NerToken[] = [
      { entity: 'B-PER', score: 0.99, word: 'Mario', start: 0, end: 5 },
      { entity: 'I-LOC', score: 0.90, word: 'Rossi', start: 6, end: 11 }, // label switch mid-span
    ];
    const extractor = new OnnxNerExtractor(fakeClassifier(tokens));
    const result = await extractor.extract(TEXT, { language: 'en' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const names = result.value.map((e) => e.name);
    expect(names).toContain('Mario');
    expect(names).toContain('Rossi');
  });

  it('joins WordPiece subwords when char offsets are missing', async () => {
    const tokens: NerToken[] = [
      { entity: 'B-PER', score: 0.9, word: 'Bald' },
      { entity: 'I-PER', score: 0.9, word: '##ini' },
    ];
    const extractor = new OnnxNerExtractor(fakeClassifier(tokens));
    const result = await extractor.extract('whatever', { language: 'en' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((e) => e.name)).toEqual(['Baldini']);
  });

  it('strips SentencePiece markers in the subword fallback', async () => {
    const tokens: NerToken[] = [
      { entity: 'B-PER', score: 0.9, word: '▁Mario' },
      { entity: 'I-PER', score: 0.9, word: '▁Rossi' },
    ];
    const extractor = new OnnxNerExtractor(fakeClassifier(tokens));
    const result = await extractor.extract('whatever', { language: 'en' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((e) => e.name)).toEqual(['Mario Rossi']);
  });

  it('dedupes entities by normalized form, most frequent surface wins', async () => {
    const tokens: NerToken[] = [
      { entity: 'B-ORG', score: 0.95, word: 'Acme', start: 37, end: 41 },
      { entity: 'B-ORG', score: 0.95, word: 'ACME', start: 37, end: 41 },
      { entity: 'B-ORG', score: 0.95, word: 'Acme', start: 37, end: 41 },
    ];
    const extractor = new OnnxNerExtractor(fakeClassifier(tokens));
    const result = await extractor.extract(TEXT, { language: 'en' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]!.id).toBe('entity_acme');
    expect(result.value[0]!.name).toBe('Acme');
  });

  it('discards spans below the average score threshold', async () => {
    const tokens: NerToken[] = [
      { entity: 'B-PER', score: 0.99, word: 'Mario', start: 0, end: 5 },
      { entity: 'I-PER', score: 0.99, word: 'Rossi', start: 6, end: 11 },
      { entity: 'B-ORG', score: 0.40, word: 'Acme', start: 37, end: 41 },
      { entity: 'I-ORG', score: 0.30, word: 'Corporation', start: 42, end: 53 },
    ];
    const extractor = new OnnxNerExtractor(fakeClassifier(tokens));
    const result = await extractor.extract(TEXT, { language: 'en' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const names = result.value.map((e) => e.name);
    expect(names).toContain('Mario Rossi');
    expect(names).not.toContain('Acme Corporation');
  });

  it('filters stopwords through the language pack', async () => {
    const tokens: NerToken[] = [
      { entity: 'B-MISC', score: 0.99, word: 'The', start: 0, end: 3 },
    ];
    const extractor = new OnnxNerExtractor(fakeClassifier(tokens));
    const result = await extractor.extract('The quick brown fox', { language: 'en' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });

  it('maps MISC to concept', async () => {
    const tokens: NerToken[] = [
      { entity: 'B-MISC', score: 0.9, word: 'GraphQL', start: 0, end: 7 },
    ];
    const extractor = new OnnxNerExtractor(fakeClassifier(tokens));
    const result = await extractor.extract('GraphQL', { language: 'en' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]?.type).toBe('concept');
  });

  it('ignores tokens with unknown labels', async () => {
    const tokens: NerToken[] = [
      { entity: 'O', score: 0.1, word: 'signed', start: 12, end: 18 },
      { entity: 'B-XYZ', score: 0.9, word: 'Mystery', start: 0, end: 7 },
    ];
    const extractor = new OnnxNerExtractor(fakeClassifier(tokens));
    const result = await extractor.extract(TEXT, { language: 'en' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });

  it('returns an empty array for blank text', async () => {
    const extractor = new OnnxNerExtractor(fakeClassifier(BASIC_TOKENS));
    const result = await extractor.extract('   ');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });
});
