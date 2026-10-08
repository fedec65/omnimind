import { describe, it, expect } from 'vitest';
import { NullProvider } from '../../../src/core/llm/NullProvider.js';

describe('NullProvider', () => {
  it('is unconfigured by definition', () => {
    const p = new NullProvider();
    expect(p.name).toBe('null');
    expect(p.isConfigured()).toBe(false);
  });

  it('summarize always returns a config error', async () => {
    const r = await new NullProvider().summarize('hello world');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('config');
  });

  it('health always returns a config error', async () => {
    const r = await new NullProvider().health();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('config');
  });
});