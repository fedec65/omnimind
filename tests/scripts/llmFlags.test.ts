import { describe, it, expect } from 'vitest';
import { parseLlmEnableArgs } from '../../src/cli/llmFlags.js';

describe('parseLlmEnableArgs', () => {
  it('parses provider, base-url, model, timeout', () => {
    const r = parseLlmEnableArgs([
      '--provider',
      'ollama',
      '--base-url',
      'http://127.0.0.1:11434',
      '--model',
      'qwen2.5:3b',
      '--timeout-ms',
      '20000',
    ]);
    expect(r).toEqual({
      provider: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen2.5:3b',
      timeoutMs: '20000',
    });
  });

  it('rejects a missing/unknown provider', () => {
    const r = parseLlmEnableArgs(['--provider', 'openai']);
    expect(r).toBeNull();
  });
});