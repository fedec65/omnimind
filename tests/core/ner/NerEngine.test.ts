/**
 * NerEngine tests — engine selection, ONNX fallback, info reporting.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  configureNerEngine,
  extractEntitiesAsync,
  getNerEngineInfo,
  initNerEngine,
  resetNerEngine,
  setOnnxExtractorForTest,
} from '../../../src/core/ner/NerEngine.js';
import { OnnxNerExtractor, type NerToken } from '../../../src/core/ner/OnnxNerExtractor.js';

afterEach(() => {
  resetNerEngine();
});

describe('NerEngine', () => {
  it('defaults to the heuristic engine', () => {
    const info = getNerEngineInfo();
    expect(info.configured).toBe('heuristic');
    expect(info.active).toBe('heuristic');
    expect(info.modelLoaded).toBe(false);
    expect(info.loadFailed).toBe(false);
  });

  it('initNerEngine is a no-op for the heuristic engine', async () => {
    configureNerEngine('heuristic');
    const result = await initNerEngine();
    expect(result.ok).toBe(true);
    expect(getNerEngineInfo().modelLoaded).toBe(false);
  });

  it('extractEntitiesAsync falls back to the heuristic when no model is loaded', async () => {
    const entities = await extractEntitiesAsync('We chose GraphQL over REST for the API.');
    expect(entities.some((e) => e.name === 'GraphQL')).toBe(true);
  });

  it('uses the injected ONNX extractor when configured', async () => {
    const tokens: NerToken[] = [
      { entity: 'B-PER', score: 0.99, word: 'Mario', start: 0, end: 5 },
      { entity: 'I-PER', score: 0.99, word: 'Rossi', start: 6, end: 11 },
    ];
    setOnnxExtractorForTest(new OnnxNerExtractor(async () => tokens));
    configureNerEngine('onnx');

    const info = getNerEngineInfo();
    expect(info.active).toBe('onnx');
    expect(info.modelLoaded).toBe(true);

    const entities = await extractEntitiesAsync('Mario Rossi signed.', { language: 'en' });
    expect(entities.map((e) => e.name)).toEqual(['Mario Rossi']);
    expect(entities[0]!.type).toBe('person');
  });

  it('falls back to the heuristic when ONNX extraction fails', async () => {
    setOnnxExtractorForTest(
      new OnnxNerExtractor(async () => {
        throw new Error('boom');
      }),
    );
    configureNerEngine('onnx');

    const entities = await extractEntitiesAsync('We chose GraphQL over REST for the API.');
    expect(entities.some((e) => e.name === 'GraphQL')).toBe(true);
  });

  it('resetNerEngine restores the default state', () => {
    setOnnxExtractorForTest(new OnnxNerExtractor(async () => []));
    configureNerEngine('onnx');
    resetNerEngine();
    const info = getNerEngineInfo();
    expect(info.configured).toBe('heuristic');
    expect(info.active).toBe('heuristic');
    expect(info.modelLoaded).toBe(false);
  });
});
