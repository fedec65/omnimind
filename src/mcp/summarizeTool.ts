/**
 * Pure logic for the omnimind_summarize MCP tool.
 *
 * Kept separate from src/mcp/server.ts so the schema, result builder, and
 * error mappings can be unit-tested without spinning up an MCP Server.
 */

import { z } from 'zod';
import type { LLMProvider } from '../core/llm/index.js';
import { llmErrorMessage } from '../core/llm/errors.js';

export const SUMMARIZE_TOOL_NAME = 'omnimind_summarize';

export const SUMMARIZE_NOT_CONFIGURED_MESSAGE =
  'LLM not configured. Enable it in Settings → Local LLM.';

export const SUMMARIZE_UNREACHABLE_MESSAGE =
  'Local LLM unreachable. Check Settings → Local LLM → Test connection.';

export const SummarizeInputSchema = z.object({
  text: z
    .string()
    .min(1, 'text must not be empty')
    .max(8000, 'text must be at most 8000 characters'),
  maxWords: z
    .number()
    .int()
    .min(10)
    .max(500)
    .optional()
    .default(80),
});

export type SummarizeInput = z.infer<typeof SummarizeInputSchema>;

export type SummarizeResult =
  | {
      readonly ok: true;
      readonly summary: string;
      readonly provider: string;
      readonly model: string | null;
    }
  | { readonly ok: false; readonly error: string };

export async function buildSummarizeResult(
  input: SummarizeInput,
  provider: LLMProvider,
): Promise<SummarizeResult> {
  if (!provider.isConfigured()) {
    return { ok: false, error: SUMMARIZE_NOT_CONFIGURED_MESSAGE };
  }

  const response = await provider.summarize(input.text, { maxWords: input.maxWords });
  if (response.ok) {
    const model =
      'model' in provider && typeof provider.model === 'string' ? provider.model : null;
    return {
      ok: true,
      summary: response.value,
      provider: provider.name,
      model,
    };
  }

  if (response.error.kind === 'unavailable') {
    return { ok: false, error: SUMMARIZE_UNREACHABLE_MESSAGE };
  }

  return { ok: false, error: llmErrorMessage(response.error) };
}
