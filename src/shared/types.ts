/**
 * Shared memory server — types and contract
 *
 * The shared server is a remote MCP endpoint hosting promoted (L2/L3)
 * team/org memory. This module defines the client contract; the rest of
 * the codebase only sees SharedClient — no HTTP/MCP details leak out.
 */

import type { Result } from '../core/types.js';

// ─── Errors ──────────────────────────────────────────────────────

export type SharedErrorKind = 'unauthorized' | 'rate_limited' | 'server' | 'network' | 'malformed';

export class SharedError extends Error {
  readonly kind: SharedErrorKind;

  constructor(kind: SharedErrorKind, message: string) {
    super(message);
    this.name = 'SharedError';
    this.kind = kind;
  }
}

// ─── Config ──────────────────────────────────────────────────────

export interface SharedClientConfig {
  /** MCP endpoint URL, e.g. https://host/mcp */
  readonly serverUrl: string;
  /** Opaque token (omt_...), sent as Bearer */
  readonly token: string;
  /** Per-call timeout in ms (default 4000) */
  readonly timeoutMs?: number | undefined;
  /** Max retries on transient failures (default 2) */
  readonly maxRetries?: number | undefined;
  /** Base retry delay in ms, doubles per attempt (default 500) */
  readonly retryDelayMs?: number | undefined;
}

// ─── Data ────────────────────────────────────────────────────────

export interface SharedItem {
  readonly id: string;
  readonly content: string;
  readonly level: number;
  readonly visibility: 'team' | 'org';
  readonly metadata: Record<string, unknown>;
  readonly trustWeight: number;
  readonly createdAt: number;
  readonly supersededAt: number | null;
}

export interface SharedSearchResult {
  readonly item: SharedItem;
  readonly score: number;
  readonly matchType: string;
}

export interface SharedStatus {
  readonly items: number;
  readonly superseded: number;
}

export interface SharedPublishInput {
  readonly level: 2 | 3;
  readonly visibility: 'team' | 'org';
  readonly content: string;
  readonly trustWeight?: number | undefined;
  readonly workspaceId?: string | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

/** A local L2/L3 memory the user may want to publish. */
export interface SharedSuggestion {
  readonly memoryId: string;
  readonly content: string;
  readonly level: number;
  readonly suggestedAt: number;
}

// ─── Transport (injectable for tests) ────────────────────────────

/**
 * Lowest-level seam: performs one MCP tools/call and returns the raw
 * tool result. The default implementation speaks StreamableHTTP; tests
 * inject a fake. `reset()` drops any connection state before a retry.
 */
export interface SharedToolTransport {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

// ─── Client contract ─────────────────────────────────────────────

export interface SharedClient {
  search(queryText: string, limit?: number | undefined): Promise<Result<SharedSearchResult[], SharedError>>;
  publish(input: SharedPublishInput): Promise<Result<string, SharedError>>;
  status(): Promise<Result<SharedStatus, SharedError>>;
  close(): Promise<void>;
}
