/** Ollama provider — POST {base}/api/chat, GET {base}/api/tags for health. */
import { type Result, ok, err } from '../types.js';
import type { LLMError } from './errors.js';
import type { LLMProvider, LLMConfig, LLMSummaryOptions } from './LLMProvider.js';
import { httpRequest } from './httpRequest.js';

const SYSTEM_PROMPT =
  "You are a local memory assistant. Summarize the user's text in N words. Preserve concrete details: filenames, function names, error messages, exact decisions. Do not add information that is not in the text. Respond with the summary only.";

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama' as const;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: LLMConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.model = config.model;
    this.timeoutMs = config.timeoutMs;
  }

  isConfigured(): boolean {
    return true;
  }

  async summarize(text: string, opts?: LLMSummaryOptions | undefined): Promise<Result<string, LLMError>> {
    const maxWords = opts?.maxWords ?? 80;
    const result = await httpRequest({
      url: `${this.baseUrl}/api/chat`,
      method: 'POST',
      body: {
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
        stream: false,
        options: { num_predict: maxWords * 2 },
      },
      timeoutMs: this.timeoutMs,
      signal: opts?.signal,
    });
    if (!result.ok) return err(result.error);
    const body = result.value as { message?: { content?: unknown } } | undefined;
    if (typeof body?.message?.content !== 'string') {
      return err({ kind: 'response', status: 200, body: 'malformed response' });
    }
    return ok(body.message.content);
  }

  async health(): Promise<Result<true, LLMError>> {
    const result = await httpRequest({ url: `${this.baseUrl}/api/tags`, method: 'GET', timeoutMs: this.timeoutMs });
    if (!result.ok) return err(result.error);
    const body = result.value as { models?: Array<{ name?: unknown }> } | undefined;
    const present =
      Array.isArray(body?.models) &&
      body.models.some((m) => typeof m?.name === 'string' && m.name === this.model);
    if (!present) return err({ kind: 'response', status: 200, body: 'model not pulled' });
    return ok(true);
  }
}
