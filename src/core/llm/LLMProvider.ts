/**
 * LLMProvider — pluggable local LLM interface (Ollama, LM Studio).
 * Off by default: the concrete default is NullProvider (Task 4).
 */
import type { Result } from '../types.js';

/** A single chat message sent to a local LLM. */
export interface LLMMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

/** Options for a summarize() call. */
export interface LLMSummaryOptions {
  readonly maxWords?: number | undefined;
  readonly style?: 'bullet' | 'paragraph' | undefined;
  readonly signal?: AbortSignal | undefined;
}

/** Resolved provider configuration after defaults + loopback validation. */
export interface LLMConfig {
  readonly provider: 'ollama' | 'lmstudio';
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs: number;
}

/** A swappable local LLM provider. */
export interface LLMProvider {
  readonly name: 'null' | 'ollama' | 'lmstudio';
  isConfigured(): boolean;
  summarize(text: string, opts?: LLMSummaryOptions | undefined): Promise<Result<string, import('./errors.js').LLMError>>;
  health(): Promise<Result<true, import('./errors.js').LLMError>>;
}

/** Public config exposed to the GUI (what Settings shows). */
export interface LLMConfigPublic {
  readonly enabled: boolean;
  readonly provider: 'ollama' | 'lmstudio' | null;
  readonly model: string | null;
  readonly baseUrl: string | null;
  readonly timeoutMs: number;
}

/** Live status combining config with a connectivity probe. */
export interface LLMStatus {
  readonly configured: boolean;
  readonly provider: 'null' | 'ollama' | 'lmstudio';
  readonly baseUrl?: string | undefined;
  readonly model?: string | undefined;
  readonly reachable: boolean;
  readonly latencyMs?: number | undefined;
  readonly error?: string | undefined;
}
