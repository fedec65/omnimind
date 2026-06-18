/**
 * Omnimind Context Compressor
 *
 * Truncates a chat history / context window to a token budget while
 * preserving `<omnimind_predictions>...</omnimind_predictions>` blocks
 * intact. Standalone (no MemoryStore or predictor dependency) so it can
 * be unit-tested in isolation and invoked from any caller (MCP tool,
 * HTTP handler, future middleware).
 *
 * Token counting uses the same word-split heuristic as ContextInjector
 * (`text.split(/\s+/).filter(w => w.length > 0).length`) so the two
 * paths stay in lockstep.
 *
 * Strategy:
 *  1. Under-budget input → return unchanged.
 *  2. Extract all prediction blocks.
 *  3. If blocks alone exceed the budget → degraded mode: each block is
 *     middle-truncated to a per-block share and a warning is set.
 *  4. Otherwise → strip blocks from body, head-trim body to remaining
 *     budget, then re-append the original blocks in original order.
 *     Placing blocks at the end guarantees preservation even when the
 *     body alone exceeds the budget.
 */

import { type Result, ok, err } from '../core/types.js';

/** Matches <omnimind_predictions>...</omnimind_predictions> blocks. */
export const PREDICTIONS_RE =
  /<omnimind_predictions\b[^>]*>[\s\S]*?<\/omnimind_predictions>/g;

export interface CompressOptions {
  tokenBudget: number;
}

export interface CompressResult {
  text: string;
  tokensBefore: number;
  tokensAfter: number;
  predictionsKept: number;
  predictionsTruncated: boolean;
  warning: string | null;
}

/** Word-split token estimate. Matches ContextInjector.estimateTokens style. */
export function estimateTokens(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

/**
 * Compress `text` to fit `opts.tokenBudget` tokens while preserving
 * every `<omnimind_predictions>...</omnimind_predictions>` block intact.
 */
export function compressContext(
  text: string,
  opts: CompressOptions,
): Result<CompressResult> {
  if (opts.tokenBudget <= 0) {
    return err(new Error('tokenBudget must be > 0'));
  }

  const tokensBefore = estimateTokens(text);

  // Under budget — no-op fast path
  if (tokensBefore <= opts.tokenBudget) {
    const blocks = text.match(PREDICTIONS_RE) ?? [];
    return ok({
      text,
      tokensBefore,
      tokensAfter: tokensBefore,
      predictionsKept: blocks.length,
      predictionsTruncated: false,
      warning: null,
    });
  }

  const blocks = text.match(PREDICTIONS_RE) ?? [];
  const blocksTokens = blocks.reduce((s, b) => s + estimateTokens(b), 0);

  // Degraded mode: predictions themselves exceed the budget
  if (blocksTokens > opts.tokenBudget) {
    const perBlock = Math.max(
      20,
      Math.floor(opts.tokenBudget / Math.max(blocks.length, 1)) - 2,
    );
    const truncated = blocks
      .map((b) => truncateFromMiddle(b, perBlock))
      .join('\n');
    return ok({
      text: truncated,
      tokensBefore,
      tokensAfter: estimateTokens(truncated),
      predictionsKept: blocks.length,
      predictionsTruncated: true,
      warning: `Predictions alone exceed the token budget; truncated ${blocks.length} block(s) to ~${perBlock} tokens each.`,
    });
  }

  // Normal path: strip blocks from body, head-trim body, re-append blocks.
  const bodyOnly = text.replace(PREDICTIONS_RE, '');
  const remainingBudget = opts.tokenBudget - blocksTokens;
  const trimmedBody = trimTextToTokens(bodyOnly, remainingBudget);
  const finalText = blocks.length > 0 ? `${trimmedBody}\n${blocks.join('\n')}` : trimmedBody;

  return ok({
    text: finalText,
    tokensBefore,
    tokensAfter: estimateTokens(finalText),
    predictionsKept: blocks.length,
    predictionsTruncated: false,
    warning: null,
  });
}

/**
 * Head-preserving trim: keep the first `max` words; if there were
 * more, append a `[...truncated N words...]` marker. The trim
 * itself accounts for the marker's token cost so the final string
 * is at most `max` tokens.
 */
function trimTextToTokens(text: string, max: number): string {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length <= max) return text;
  const markerTokens = 4; // [...truncated | N | words...]
  const keepWords = Math.max(0, max - markerTokens);
  const kept = keepWords > 0 ? words.slice(0, keepWords).join(' ') : '';
  return `${kept}\n[...truncated ${words.length - keepWords} words...]`;
}

/**
 * Middle-truncate a single block to roughly `maxTokens` words,
 * preserving the opening and closing tags intact.
 */
function truncateFromMiddle(block: string, maxTokens: number): string {
  const words = block.split(/\s+/).filter((w) => w.length > 0);
  if (words.length <= maxTokens) return block;
  const half = Math.floor(maxTokens / 2) - 1;
  const head = words.slice(0, half).join(' ');
  const tail = words.slice(words.length - half).join(' ');
  return `${head} ... ${tail}`;
}