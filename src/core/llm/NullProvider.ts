/** Default no-op provider: off by default until a user opts in. */
import { type Result, err } from '../types.js';
import type { LLMError } from './errors.js';
import type { LLMProvider } from './LLMProvider.js';

export class NullProvider implements LLMProvider {
  readonly name = 'null' as const;

  isConfigured(): boolean {
    return false;
  }

  async summarize(): Promise<Result<string, LLMError>> {
    return err({ kind: 'config', reason: 'LLM provider not configured' });
  }

  async health(): Promise<Result<true, LLMError>> {
    return err({ kind: 'config', reason: 'LLM provider not configured' });
  }
}