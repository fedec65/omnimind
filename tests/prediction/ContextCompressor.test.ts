import { describe, it, expect } from 'vitest';
import {
  compressContext,
  estimateTokens,
  PREDICTIONS_RE,
} from '../../src/prediction/ContextCompressor.js';

const SINGLE_BLOCK = '<omnimind_predictions confidence="0.85" count="2">\nline one\nline two\n</omnimind_predictions>';
const SECOND_BLOCK = '<omnimind_predictions confidence="0.42" count="1">\nonly one\n</omnimind_predictions>';

function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
}

describe('estimateTokens', () => {
  it('counts words by whitespace split', () => {
    expect(estimateTokens('hello world')).toBe(2);
    expect(estimateTokens('  spaced   out  ')).toBe(2);
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('single')).toBe(1);
  });
});

describe('compressContext', () => {
  it('returns text unchanged when under budget', () => {
    const text = 'hello world';
    const result = compressContext(text, { tokenBudget: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).toBe(text);
    expect(result.value.tokensBefore).toBe(2);
    expect(result.value.tokensAfter).toBe(2);
    expect(result.value.predictionsKept).toBe(0);
    expect(result.value.warning).toBeNull();
  });

  it('preserves a single prediction block byte-for-byte', () => {
    const body = words(200);
    const input = `${body} ${SINGLE_BLOCK}`;
    const result = compressContext(input, { tokenBudget: 80 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The exact block string must be in the output
    expect(result.value.text).toContain(SINGLE_BLOCK);
    expect(result.value.predictionsKept).toBe(1);
    expect(result.value.predictionsTruncated).toBe(false);
    expect(result.value.warning).toBeNull();
    // Output respects the budget
    expect(result.value.tokensAfter).toBeLessThanOrEqual(80);
  });

  it('preserves multiple prediction blocks in original order', () => {
    const body = words(200);
    const input = `${body} ${SINGLE_BLOCK} ${words(20)} ${SECOND_BLOCK}`;
    const result = compressContext(input, { tokenBudget: 120 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.text).toContain(SINGLE_BLOCK);
    expect(result.value.text).toContain(SECOND_BLOCK);

    const a = result.value.text.indexOf(SINGLE_BLOCK);
    const b = result.value.text.indexOf(SECOND_BLOCK);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(b);
    expect(result.value.predictionsKept).toBe(2);
  });

  it('still preserves blocks when body alone exceeds the budget', () => {
    // Body has 500 words; budget is 50; both blocks must survive.
    const input = `${words(500)} ${SINGLE_BLOCK} ${SECOND_BLOCK}`;
    const result = compressContext(input, { tokenBudget: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).toContain(SINGLE_BLOCK);
    expect(result.value.text).toContain(SECOND_BLOCK);
    expect(result.value.tokensAfter).toBeLessThanOrEqual(50);
  });

  it('enters degraded mode when predictions alone exceed the budget', () => {
    // Block is ~10 words + tags ≈ 12 tokens; budget 5 forces degradation
    const result = compressContext(SINGLE_BLOCK, { tokenBudget: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.predictionsTruncated).toBe(true);
    expect(result.value.warning).not.toBeNull();
    expect(result.value.predictionsKept).toBe(1);
  });

  it('handles empty input', () => {
    const result = compressContext('', { tokenBudget: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).toBe('');
    expect(result.value.tokensBefore).toBe(0);
    expect(result.value.predictionsKept).toBe(0);
  });

  it('rejects invalid (non-positive) budgets', () => {
    expect(compressContext('x', { tokenBudget: 0 }).ok).toBe(false);
    expect(compressContext('x', { tokenBudget: -1 }).ok).toBe(false);
  });

  it('tokensAfter never exceeds budget across many randomized inputs', () => {
    for (let i = 0; i < 25; i++) {
      const body = words(50 + Math.floor(Math.random() * 200));
      const hasBlock = i % 3 === 0;
      const input = hasBlock ? `${body} ${SINGLE_BLOCK}` : body;
      const budget = 40 + Math.floor(Math.random() * 60);
      const result = compressContext(input, { tokenBudget: budget });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.value.tokensAfter).toBeLessThanOrEqual(budget);
    }
  });

  it('regex matches the exact tag format used by ContextInjector', () => {
    // Sanity: the regex matches the actual ContextInjector tag with attributes
    const fromContextInjector =
      '\n<omnimind_predictions confidence="0.85" count="2">\nentry one\nentry two\n</omnimind_predictions>\n';
    expect(fromContextInjector.match(PREDICTIONS_RE)).not.toBeNull();
    expect(fromContextInjector.match(PREDICTIONS_RE)?.length).toBe(1);
  });

  it('does not corrupt input when there are no prediction blocks', () => {
    const body = words(150);
    const result = compressContext(body, { tokenBudget: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Body should be truncated; no prediction markers should appear
    expect(result.value.text).not.toContain('<omnimind_predictions');
    expect(result.value.predictionsKept).toBe(0);
    expect(result.value.tokensAfter).toBeLessThanOrEqual(50);
  });
});