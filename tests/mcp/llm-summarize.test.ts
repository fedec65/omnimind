/**
 * Tests for the omnimind_summarize MCP tool.
 *
 * Pure-logic shape lives in src/mcp/summarizeTool.ts so it can be exercised
 * without spinning up an MCP Server.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  SummarizeInputSchema,
  buildSummarizeResult,
  SUMMARIZE_TOOL_NAME,
  SUMMARIZE_NOT_CONFIGURED_MESSAGE,
  SUMMARIZE_UNREACHABLE_MESSAGE,
} from '../../src/mcp/summarizeTool.js';
import { NullProvider, type LLMProvider } from '../../src/core/llm/index.js';

class FakeProvider implements LLMProvider {
  readonly name = 'ollama' as const;
  readonly model = 'qwen2.5:3b';
  isConfigured(): boolean {
    return true;
  }
  async summarize(text: string): Promise<{ ok: true; value: string }> {
    return { ok: true, value: `sum(${text})` };
  }
  async health(): Promise<{ ok: true; value: true }> {
    return { ok: true, value: true };
  }
}

class UnreachableProvider implements LLMProvider {
  readonly name = 'ollama' as const;
  readonly model = 'qwen2.5:3b';
  isConfigured(): boolean {
    return true;
  }
  async summarize(): Promise<{ ok: false; error: { kind: 'unavailable'; cause: string } }> {
    return { ok: false, error: { kind: 'unavailable', cause: 'connection refused' } };
  }
  async health(): Promise<{ ok: false; error: { kind: 'unavailable'; cause: string } }> {
    return { ok: false, error: { kind: 'unavailable', cause: 'connection refused' } };
  }
}

describe('SummarizeInputSchema', () => {
  it('defaults maxWords to 80 when omitted', () => {
    const parsed = SummarizeInputSchema.parse({ text: 'hi' });
    expect(parsed.maxWords).toBe(80);
  });

  it('rejects empty text', () => {
    expect(() => SummarizeInputSchema.parse({ text: '' })).toThrow(z.ZodError);
  });

  it('rejects out-of-range maxWords', () => {
    expect(() => SummarizeInputSchema.parse({ text: 'hi', maxWords: 5 })).toThrow(z.ZodError);
    expect(() => SummarizeInputSchema.parse({ text: 'hi', maxWords: 501 })).toThrow(z.ZodError);
  });
});

describe('buildSummarizeResult', () => {
  it('returns ok summary when provider succeeds', async () => {
    const result = await buildSummarizeResult(
      { text: 'hello world', maxWords: 100 },
      new FakeProvider(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toBe('sum(hello world)');
      expect(result.provider).toBe('ollama');
      expect(result.model).toBe('qwen2.5:3b');
    }
  });

  it('returns not-configured error for NullProvider', async () => {
    const result = await buildSummarizeResult(
      { text: 'hello world', maxWords: 80 },
      new NullProvider(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(SUMMARIZE_NOT_CONFIGURED_MESSAGE);
    }
  });

  it('returns unreachable error when provider returns unavailable', async () => {
    const result = await buildSummarizeResult(
      { text: 'hello world', maxWords: 80 },
      new UnreachableProvider(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(SUMMARIZE_UNREACHABLE_MESSAGE);
    }
  });
});

describe('tool registration', () => {
  it('exposes the canonical tool name', () => {
    expect(SUMMARIZE_TOOL_NAME).toBe('omnimind_summarize');
  });
});
