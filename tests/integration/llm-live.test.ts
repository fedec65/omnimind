// tests/integration/llm-live.test.ts
import { describe, it, expect } from 'vitest';
import { OllamaProvider } from '../../src/core/llm/OllamaProvider.js';

const LIVE = process.env.OMNIMIND_LLM_TEST_LIVE === '1';
const OLLAMA_URL = process.env.OMNIMIND_LLM_BASE_URL ?? 'http://127.0.0.1:11434';

describe.skipIf(!LIVE)('live Ollama (gated by OMNIMIND_LLM_TEST_LIVE=1)', () => {
  it('summarizes a short prompt with non-empty output', async () => {
    const provider = new OllamaProvider({
      provider: 'ollama',
      baseUrl: OLLAMA_URL,
      model: process.env.OMNIMIND_LLM_MODEL ?? 'qwen2.5:3b',
      timeoutMs: 10000,
    });
    const r = await provider.summarize('Hello. Please reply with the single word: ready.', { maxWords: 30 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.trim().length).toBeGreaterThan(0);
  });
});
