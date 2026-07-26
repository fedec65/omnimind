/**
 * Language packs for the heuristic NER.
 *
 * Each pack provides stopwords (always rejected) and common words
 * (rejected when they make up the whole candidate). Packs are merged
 * for mixed/unknown-language texts.
 */

import * as en from './stopwords/en.js';
import * as it from './stopwords/it.js';
import * as fr from './stopwords/fr.js';
import * as de from './stopwords/de.js';
import * as es from './stopwords/es.js';
import * as pt from './stopwords/pt.js';

export interface LanguagePack {
  stopwords: ReadonlySet<string>;
  commonWords: ReadonlySet<string>;
}

const PACKS: Record<string, { stopwords: readonly string[]; commonWords: readonly string[] }> = {
  en: { stopwords: en.STOPWORDS, commonWords: en.COMMON_WORDS },
  it: { stopwords: it.STOPWORDS, commonWords: it.COMMON_WORDS },
  fr: { stopwords: fr.STOPWORDS, commonWords: fr.COMMON_WORDS },
  de: { stopwords: de.STOPWORDS, commonWords: de.COMMON_WORDS },
  es: { stopwords: es.STOPWORDS, commonWords: es.COMMON_WORDS },
  pt: { stopwords: pt.STOPWORDS, commonWords: pt.COMMON_WORDS },
};

const cache = new Map<string, LanguagePack>();

const buildPack = (lang: string): LanguagePack => {
  const src = PACKS[lang] ?? PACKS['en']!;
  return {
    stopwords: new Set(src.stopwords),
    commonWords: new Set(src.commonWords),
  };
};

/** Get the pack for a language code ('en', 'it', ...). Unknown → English. */
export function getLanguagePack(lang: string): LanguagePack {
  const key = PACKS[lang] ? lang : 'en';
  let pack = cache.get(key);
  if (!pack) {
    pack = buildPack(key);
    cache.set(key, pack);
  }
  return pack;
}

/** Merge several packs (used for mixed/unknown-language texts). */
export function mergePacks(langs: string[]): LanguagePack {
  const unique = [...new Set(langs)].sort();
  const key = `merge:${unique.join(',')}`;
  let pack = cache.get(key);
  if (!pack) {
    const stopwords = new Set<string>();
    const commonWords = new Set<string>();
    for (const lang of unique) {
      const p = getLanguagePack(lang);
      for (const w of p.stopwords) stopwords.add(w);
      for (const w of p.commonWords) commonWords.add(w);
    }
    pack = { stopwords, commonWords };
    cache.set(key, pack);
  }
  return pack;
}

/** All supported language codes */
export const SUPPORTED_LANGUAGES = Object.keys(PACKS) as readonly string[];
