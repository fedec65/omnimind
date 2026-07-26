/**
 * EntityExtractor tests
 *
 * Tests the heuristic NER: stoplist, sentence-initial discount,
 * canonicalization, and caps.
 */

import { describe, it, expect } from 'vitest';
import {
  extractEntities,
  isPlausibleEntity,
  normalizeEntityName,
} from '../../src/core/EntityExtractor.js';
import { getLanguagePack } from '../../src/core/ner/languagePack.js';

const EN_PACK = getLanguagePack('en');

describe('EntityExtractor', () => {
  it('keeps real proper nouns and tech terms', () => {
    const entities = extractEntities('The API uses GraphQL and depends on PostgreSQL. Redis is a cache.');
    const names = entities.map((e) => e.name);
    expect(names).toContain('GraphQL');
    expect(names).toContain('PostgreSQL');
    expect(names).toContain('Redis');
  });

  it('rejects discourse markers and sentence starters (Let, Now, Perfect, You)', () => {
    const entities = extractEntities(
      'Let me check. Now we run the tests. Perfect, it works. You can see MCP here.',
    );
    const names = entities.map((e) => e.name);
    expect(names).not.toContain('Let');
    expect(names).not.toContain('Now');
    expect(names).not.toContain('Perfect');
    expect(names).not.toContain('You');
    expect(names).toContain('MCP');
  });

  it('rejects common dictionary words even when capitalized', () => {
    const entities = extractEntities('Memory is important. Time flies. Tests pass.');
    const names = entities.map((e) => e.name);
    expect(names).not.toContain('Memory');
    expect(names).not.toContain('Time');
    expect(names).not.toContain('Tests');
  });

  it('rejects predominantly-lowercase words (sentence-initial discount)', () => {
    // "Buffer" appears once capitalized, "buffer" three times → regular word
    const entities = extractEntities('Buffer the stream: buffer reads, buffer writes, buffer flush.');
    const names = entities.map((e) => e.name);
    expect(names).not.toContain('Buffer');
  });

  it('keeps a proper noun with only a casual lowercase mention', () => {
    const entities = extractEntities('GraphQL is the choice. We also call it graphql informally.');
    const names = entities.map((e) => e.name);
    expect(names).toContain('GraphQL');
  });

  it('canonicalizes surface variants into one entity', () => {
    const entities = extractEntities('TaskOutput returns results. The "task output" tool helps.');
    const matches = entities.filter((e) => e.id === 'entity_taskoutput');
    expect(matches.length).toBe(1);
  });

  it('keeps acronyms', () => {
    const entities = extractEntities('The MCP and API both use JSON.');
    const names = entities.map((e) => e.name);
    expect(names).toContain('MCP');
    expect(names).toContain('API');
    expect(names).toContain('JSON');
  });

  it('caps extraction at 15 entities', () => {
    const text = Array.from({ length: 30 }, (_, i) => `Zebra${i}Kqx${i} visited.`).join(' ');
    const entities = extractEntities(text);
    expect(entities.length).toBeLessThanOrEqual(15);
  });

  it('rejects short tokens (< 3 chars)', () => {
    const entities = extractEntities('Go to HQ now.');
    const names = entities.map((e) => e.name);
    expect(names).not.toContain('Go');
    expect(names).not.toContain('HQ'); // 2-char acronyms are filtered by the length rule
  });
});

describe('isPlausibleEntity', () => {
  it('rejects stopwords and short names', () => {
    expect(isPlausibleEntity('Let', EN_PACK)).toBe(false);
    expect(isPlausibleEntity('the', EN_PACK)).toBe(false);
    expect(isPlausibleEntity('ab', EN_PACK)).toBe(false);
    expect(isPlausibleEntity('TaskOutput', EN_PACK)).toBe(true);
  });
});

describe('normalizeEntityName', () => {
  it('merges surface variants', () => {
    expect(normalizeEntityName('TaskOutput')).toBe('taskoutput');
    expect(normalizeEntityName('task output')).toBe('taskoutput');
    expect(normalizeEntityName('task-output')).toBe('taskoutput');
  });
});
