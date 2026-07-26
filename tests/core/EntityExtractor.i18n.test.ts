/**
 * EntityExtractor i18n tests — language packs, accents, auto-detection.
 */

import { describe, it, expect } from 'vitest';
import {
  extractEntities,
  isPlausibleEntity,
  normalizeEntityName,
} from '../../src/core/EntityExtractor.js';
import { getLanguagePack, mergePacks } from '../../src/core/ner/languagePack.js';

describe('EntityExtractor — Italian', () => {
  it('rejects Italian discourse noise (Il, Ora, Allora, Quindi)', () => {
    const entities = extractEntities(
      'Il contratto è valido. Ora vediamo il ricorso. Allora procediamo. Quindi il Tribunale decide.',
      { language: 'it' },
    );
    const names = entities.map((e) => e.name);
    expect(names).not.toContain('Il');
    expect(names).not.toContain('Ora');
    expect(names).not.toContain('Allora');
    expect(names).not.toContain('Quindi');
    expect(names).toContain('Tribunale');
  });

  it('keeps real Italian entities (Codice Civile, Milano, Rossi)', () => {
    const entities = extractEntities(
      'Il Tribunale di Milano ha deciso. La parte Rossi cita il Codice Civile.',
      { language: 'it' },
    );
    const names = entities.map((e) => e.name);
    expect(names).toContain('Tribunale');
    expect(names).toContain('Milano');
    expect(names).toContain('Rossi');
    expect(names).toContain('Civile');
  });

  it('auto-detects Italian text without an explicit language option', () => {
    const entities = extractEntities(
      'Il contratto è stato firmato e la clausola che riguarda il pagamento non è valida per il cliente. Il Notaio Verdi conferma.',
    );
    const names = entities.map((e) => e.name);
    expect(names).not.toContain('Il');
    expect(names).toContain('Notaio');
    expect(names).toContain('Verdi');
  });
});

describe('EntityExtractor — accents and Unicode', () => {
  it('normalizeEntityName preserves accented letters', () => {
    expect(normalizeEntityName('Société')).toBe('société');
    expect(normalizeEntityName('Müller')).toBe('müller');
    expect(normalizeEntityName('José')).toBe('josé');
    expect(normalizeEntityName('Zürich')).toBe('zürich');
  });

  it('canonicalizes accented surface variants', () => {
    const entities = extractEntities('Müller firma. Il caso Müller continua.', { language: 'it' });
    const matches = entities.filter((e) => e.id === 'entity_müller');
    expect(matches.length).toBe(1);
  });

  it('accepts quoted accented names', () => {
    const entities = extractEntities('"Société anonyme" è una forma giuridica usata spesso.', { language: 'fr' });
    const names = entities.map((e) => e.name);
    expect(names).toContain('Société anonyme');
  });
});

describe('EntityExtractor — pack selection', () => {
  it('the same word is filtered only by the right pack', () => {
    // 'Allora' is noise in Italian but not in the English pack
    expect(isPlausibleEntity('Allora', getLanguagePack('it'))).toBe(false);
    expect(isPlausibleEntity('Allora', getLanguagePack('en'))).toBe(true);
  });

  it('merged packs filter noise from all languages', () => {
    const merged = mergePacks(['en', 'it', 'fr']);
    expect(isPlausibleEntity('Let', merged)).toBe(false);
    expect(isPlausibleEntity('Allora', merged)).toBe(false);
    expect(isPlausibleEntity('Alors', merged)).toBe(false);
    expect(isPlausibleEntity('TaskOutput', merged)).toBe(true);
  });

  it('mixed-language text uses merged packs via auto-detection', () => {
    const entities = extractEntities('Let me see il problema. Allora, the TaskOutput works now.');
    const names = entities.map((e) => e.name);
    expect(names).not.toContain('Let');
    expect(names).not.toContain('Allora');
    expect(names).toContain('TaskOutput');
  });
});
