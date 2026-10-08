/** LM Studio provider — OpenAI-compatible /v1/chat/completions, /v1/models for health. */
import { type Result, ok, err } from '../types.js';
import type { LLMError } from './errors.js';
import type { LLMProvider, LLMConfig, LLMSummaryOptions } from './LLMProvider.js';
import { httpRequest } from './httpRequest.js';

const SYSTEM_PROMPT =
  "You are a local memory assistant. Summarize the user's text in N words. Preserve concrete details: filenames, function names, error messages, exact decisions. Do not add information that is not in the text. Respond with the summary only.";

export class LMStudioProvider implements LLMProvider {
  readonly name = 'lmstudio' as const;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  /** Model auto-detected from /v1/models on the first health() call. */
  private cachedModel: string | null = null;

  constructor(config: LLMConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.model = config.model;
    this.timeoutMs = config.timeoutMs;
  }

  isConfigured(): boolean {
    return true;
  }

  private activeModel(): string {
    return this.cachedModel ?? this.model;
  }

  async summarize(text: string, opts?: LLMSummaryOptions | undefined): Promise<Result<string, LLMError>> {
    const maxWords = opts?.maxWords ?? 80;
    if (this.activeModel() === '') {
      const healthResult = await this.health();
      if (!healthResult.ok) return err(healthResult.error);
      if (this.activeModel() === '') {
        return err({ kind: 'config', reason: 'LM Studio has no models loaded' });
      }
    }
    const result = await httpRequest({
      url: `${this.baseUrl}/chat/completions`,
      method: 'POST',
      body: {
        model: this.activeModel(),
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
        max_tokens: maxWords * 2,
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
    return ok(content);
  }

  async health(): Promise<Result<true, LLMError>> {
    const result = await httpRequest({ url: `${this.baseUrl}/models`, method: 'GET', timeoutMs: this.timeoutMs });
    if (!result.ok) return err(result.error);
    const body = result.value as { data?: Array<{ id?: unknown }> } | undefined;
    const firstId = Array.isArray(body?.data) && body.data.length > 0 ? body.data[0]?.id : undefined;
    if (this.model === '' && typeof firstId === 'string') this.cachedModel = firstId;
    return ok(true);
  }
}