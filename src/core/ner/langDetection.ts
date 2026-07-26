/**
 * Language detection for the heuristic NER.
 *
 * Zero-dependency, deterministic: votes on language-specific function
 * words over the first ~200 words of the text. Function words (articles,
 * prepositions, conjunctions) are highly discriminative between Latin
 * languages. Falls back to 'mixed' for uncertain/short texts and
 * 'non-latin' when the script is mostly non-Latin.
 */

export type DetectedLanguage = 'en' | 'it' | 'fr' | 'de' | 'es' | 'pt' | 'mixed' | 'non-latin';

/** Function words per language — chosen to be mutually discriminative */
const FUNCTION_WORDS: Record<string, readonly string[]> = {
  en: ['the', 'of', 'and', 'to', 'in', 'is', 'was', 'for', 'with', 'on', 'that', 'this', 'are', 'be', 'as', 'at', 'by', 'an', 'or', 'not', 'but', 'from', 'have', 'has', 'it', 'its', 'they', 'we', 'you', 'he', 'she', 'will', 'would', 'can', 'could', 'should', 'been', 'were', 'their', 'which'],
  it: ['il', 'lo', 'la', 'di', 'che', 'e', 'un', 'una', 'per', 'con', 'non', 'del', 'della', 'dei', 'delle', 'nel', 'nella', 'alla', 'dal', 'come', 'anche', 'più', 'sono', 'era', 'essere', 'questo', 'questa', 'quello', 'quella', 'suo', 'sua', 'loro', 'gli', 'dei', 'al', 'da', 'si', 'ci', 'ne', 'tra', 'fra'],
  fr: ['le', 'la', 'les', 'de', 'des', 'du', 'et', 'un', 'une', 'est', 'dans', 'pour', 'avec', 'pas', 'sur', 'qui', 'que', 'au', 'aux', 'ce', 'cette', 'ces', 'son', 'sa', 'ses', 'nous', 'vous', 'ils', 'elles', 'être', 'sont', 'était', 'ont', 'par', 'plus', 'mais', 'ou', 'en'],
  de: ['der', 'die', 'das', 'und', 'ist', 'in', 'zu', 'den', 'mit', 'auf', 'für', 'von', 'nicht', 'ein', 'eine', 'einer', 'einem', 'einen', 'dem', 'des', 'im', 'am', 'sich', 'auch', 'als', 'an', 'aus', 'bei', 'nach', 'wie', 'wird', 'wurde', 'sind', 'war', 'haben', 'hat', 'kann'],
  es: ['el', 'la', 'los', 'las', 'de', 'y', 'en', 'un', 'una', 'es', 'por', 'para', 'con', 'no', 'del', 'al', 'que', 'su', 'sus', 'se', 'lo', 'como', 'más', 'pero', 'este', 'esta', 'estos', 'estas', 'son', 'fue', 'ser', 'está', 'han', 'tiene', 'muy', 'todo', 'también', 'entre'],
  pt: ['o', 'a', 'os', 'as', 'de', 'e', 'em', 'um', 'uma', 'é', 'por', 'para', 'com', 'não', 'do', 'da', 'dos', 'das', 'que', 'se', 'seu', 'sua', 'como', 'mais', 'mas', 'este', 'esta', 'são', 'foi', 'ser', 'está', 'têm', 'muito', 'também', 'entre', 'ao', 'na', 'no'],
};

/** Compiled word-boundary matchers per language, built once */
const MATCHERS: Record<string, RegExp[]> = Object.fromEntries(
  Object.entries(FUNCTION_WORDS).map(([lang, words]) => [
    lang,
    words.map((w) => new RegExp(`\\b${w}\\b`, 'giu')),
  ]),
);

/** Words to sample from the start of the text */
const SAMPLE_WORDS = 200;
/** Minimum fraction of votes the winner needs for a confident detection */
const CONFIDENCE_THRESHOLD = 0.6;
/** Below this many words the text is too short to tell */
const MIN_WORDS = 10;

/**
 * Detect the dominant language of a text.
 *
 * Returns 'mixed' when the evidence is weak or conflicting, 'non-latin'
 * when most characters are outside the Latin script.
 */
export function detectLanguage(text: string): DetectedLanguage {
  // Script check first: mostly non-Latin characters → non-latin
  const letters = text.match(/[a-zA-ZÀ-ɏ]/g)?.length ?? 0;
  const allLetters = text.match(/\p{L}/gu)?.length ?? 0;
  if (allLetters > 0 && letters / allLetters < 0.5) {
    return 'non-latin';
  }

  const sample = text.split(/\s+/).slice(0, SAMPLE_WORDS).join(' ');
  const wordCount = sample.trim() === '' ? 0 : sample.trim().split(/\s+/).length;
  if (wordCount < MIN_WORDS) {
    return 'mixed';
  }

  const scores: Record<string, number> = {};
  let totalHits = 0;
  for (const [lang, regexes] of Object.entries(MATCHERS)) {
    let hits = 0;
    for (const re of regexes) {
      re.lastIndex = 0;
      hits += sample.match(re)?.length ?? 0;
    }
    scores[lang] = hits;
    totalHits += hits;
  }

  if (totalHits === 0) return 'mixed';

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [winner, winnerScore] = sorted[0]!;
  const runnerUpScore = sorted[1]?.[1] ?? 0;
  if (winnerScore === 0) return 'mixed';

  // Confidence measured against the runner-up, not the grand total:
  // function words overlap heavily between Romance languages, which
  // would otherwise inflate the denominator and mask clear winners.
  const confidence = winnerScore / (winnerScore + runnerUpScore);
  if (confidence < CONFIDENCE_THRESHOLD) return 'mixed';

  return winner as DetectedLanguage;
}
