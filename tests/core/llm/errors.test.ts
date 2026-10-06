import { describe, it, expect } from 'vitest';
import { llmErrorMessage, type LLMError } from '../../../src/core/llm/errors.js';

function isConfig(e: LLMError): boolean {
  return e.kind === 'config';
}

describe('llmErrorMessage', () => {
  it('maps each union variant to a readable string', () => {
    const cases: LLMError[] = [
      { kind: 'unavailable', cause: 'connect ECONNREFUSED 127.0.0.1:11434' },
      { kind: 'response', status: 404, body: "model 'qwen2.5:3b' not found" },
      { kind: 'config', reason: 'LLM provider must be loopback' },
      { kind: 'aborted' },
    ];
    for (const e of cases) {
      const msg = llmErrorMessage(e);
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(0);
    }
  });

  it('narrows a config variant to its reason', () => {
    const e: LLMError = { kind: 'config', reason: 'LLM provider must be loopback' };
    if (isConfig(e)) {
      expect(llmErrorMessage(e)).toBe('LLM provider must be loopback');
    } else {
      throw new Error('expected narrowing to config');
    }
  });

  it('includes status and body for response errors', () => {
    const msg = llmErrorMessage({ kind: 'response', status: 404, body: 'missing' });
    expect(msg).toContain('404');
    expect(msg).toContain('missing');
  });
});
