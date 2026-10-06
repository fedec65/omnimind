import { describe, it, expect } from 'vitest';
import { assertLoopback } from '../../../src/core/llm/guard.js';

describe('assertLoopback', () => {
  it.each([
    ['http://127.0.0.1:11434', 'http://127.0.0.1:11434/'],
    ['http://localhost:1234/v1', 'http://localhost:1234/v1'],
    ['http://[::1]:11434', 'http://[::1]:11434/'],
    ['http://0.0.0.0:1234/v1', 'http://0.0.0.0:1234/v1'],
  ])('allows loopback host %s', (input, expected) => {
    const r = assertLoopback(input);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(expected);
  });

  it.each([
    ['https://api.openai.com/v1', 'LLM provider must be loopback'],
    ['http://example.com:9999', 'LLM provider must be loopback'],
    ['ftp://127.0.0.1/foo', 'protocol must be http(s)'],
    ['not a url', 'invalid URL'],
  ])('rejects %s', (input, reasonFragment) => {
    const r = assertLoopback(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.reason).toContain(reasonFragment);
  });

  it('accepts an explicit https scheme on a loopback host', () => {
    const r = assertLoopback('https://localhost:8080');
    expect(r.ok).toBe(true);
  });
});
