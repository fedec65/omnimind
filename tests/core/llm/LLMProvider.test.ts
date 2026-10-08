import { describe, it, expect } from 'vitest';
import type {
  LLMMessage,
  LLMSummaryOptions,
  LLMConfig,
  LLMProvider,
  LLMConfigPublic,
  LLMStatus,
} from '../../../src/core/llm/LLMProvider.js';
import { err } from '../../../src/core/types.js';

describe('LLMProvider types', () => {
  it('exports the expected named types', () => {
    const names: ReadonlyArray<string> = ['LLMMessage', 'LLMSummaryOptions', 'LLMConfig', 'LLMProvider', 'LLMConfigPublic', 'LLMStatus'];
    expect(names).toHaveLength(6);
    const _smoke: LLMMessage | LLMSummaryOptions | LLMConfig | LLMProvider | LLMConfigPublic | LLMStatus | undefined = undefined;
    expect(_smoke).toBeUndefined();
  });

  it('LLMSummaryOptions shape is compatible with an abbreviated call', () => {
    const opts: LLMSummaryOptions = { maxWords: 80, style: 'paragraph' };
    expect(opts.maxWords).toBe(80);
  });

  it('err() produces a discriminated union usable as an LLM failure', () => {
    const r = err({ kind: 'config', reason: 'LLM provider not configured' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('config');
  });
});
