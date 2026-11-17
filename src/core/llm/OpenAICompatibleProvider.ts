/**
 * OpenAI-compatible gateway (for example a company LiteLLM): /chat/completions
 * with a Bearer key. Used only when the deployment allows a non-loopback LLM
 * (OMNIMIND_LLM_ALLOW_REMOTE=true) and gives the key in OMNIMIND_LLM_API_KEY:
 * the person's own key, so the summaries are billed and logged as theirs.
 */
import { type Result, ok, err } from '../types.js';
import type { LLMError } from './errors.js';
import type { LLMProvider, LLMConfig, LLMSummaryOptions } from './LLMProvider.js';
import { httpRequest } from './httpRequest.js';

const SYSTEM_PROMPT =
  "You are a memory assistant. Summarize the user's text in N words. Preserve concrete details: filenames, function names, error messages, exact decisions. Do not add information that is not in the text. Respond with the summary only.";

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name = 'openai' as const;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly apiKey: string;

  constructor(config: LLMConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.model = config.model;
    this.timeoutMs = config.timeoutMs;
    this.apiKey = config.apiKey ?? '';
  }

  isConfigured(): boolean {
    return this.apiKey !== '' && this.model !== '';
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.apiKey}` };
  }

  async summarize(text: string, opts?: LLMSummaryOptions | undefined): Promise<Result<string, LLMError>> {
    const maxWords = opts?.maxWords ?? 80;
    const result = await httpRequest({
      url: `${this.baseUrl}/chat/completions`,
      method: 'POST',
      headers: this.headers(),
      body: {
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT.replace('N words', `${maxWords} words`) },
          { role: 'user', content: text },
        ],
        // Reasoning models spend tokens before answering; leave room for both.
        max_tokens: Math.max(1024, maxWords * 8),
        temperature: 0.2,
        stream: false,
      },
      timeoutMs: this.timeoutMs,
      signal: opts?.signal,
    });
    if (!result.ok) return err(result.error);
    const body = result.value as { choices?: Array<{ message?: { content?: unknown } }> } | undefined;
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      return err({ kind: 'response', status: 200, body: 'malformed response' });
    }
    // Some models put their reasoning in <think> tags before the answer.
    return ok(content.replace(/<think>[\s\S]*?<\/think>/g, '').trim());
  }

  async health(): Promise<Result<true, LLMError>> {
    const result = await httpRequest({
      url: `${this.baseUrl}/models`, method: 'GET', headers: this.headers(), timeoutMs: this.timeoutMs,
    });
    if (!result.ok) return err(result.error);
    return ok(true);
  }
}
