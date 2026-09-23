/**
 * McpSharedClient — SharedClient verso il server MCP di memoria condivisa.
 *
 * Transport stateless (StreamableHTTP): ogni POST è indipendente, nessun
 * Mcp-Session-Id. Auth via header Authorization: Bearer <omt_...>.
 * protocolVersion negoziato: 2025-03-26.
 *
 * Resilienza (requisiti PRD):
 * - retry solo su 429/5xx/network transitori, backoff esponenziale, max 2
 *   (letture: search/status); publish NON ritenta su failure ambigui
 *   (network/timeout/5xx) perché il server non ha idempotency key — solo 429
 * - MAI retry su 401
 * - timeout per chiamata (default 4s)
 * - il chiamante (facade) tratta ogni errore come fallback solo-locale
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { type Result, ok, err } from '../core/types.js';
import {
  SharedError,
  type SharedClient,
  type SharedClientConfig,
  type SharedErrorKind,
  type SharedPublishInput,
  type SharedSearchResult,
  type SharedStatus,
  type SharedToolTransport,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 500;

/** Policy di retry per letture (search/status): 429/5xx/network transitori. */
const READ_RETRYABLE = (kind: SharedErrorKind): boolean =>
  kind === 'rate_limited' || kind === 'server' || kind === 'network';

/** Policy di retry per publish: solo 429 (la richiesta è stata rifiutata). */
const ONLY_RATE_LIMITED_RETRYABLE = (kind: SharedErrorKind): boolean => kind === 'rate_limited';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Una connessione stabilita verso il server condiviso: callTool + close.
 * Il connettore di default incapsula StreamableHTTP + Client MCP; i test
 * ne iniettano uno falso per controllare connect/close.
 */
interface SharedConnection {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

type SharedConnector = () => Promise<SharedConnection>;

function defaultConnector(url: string, token: string): SharedConnector {
  return async () => {
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: {
        headers: { Authorization: `Bearer ${token}` },
      },
    });
    // protocolVersion 2025-03-26 comes from the SDK's default negotiation
    // range; the remote server pins it during initialize.
    const client = new Client({ name: 'omnimind-shared-client', version: '0.1.0' });
    await client.connect(transport as Transport);
    return {
      callTool: (name, args) => client.callTool({ name, arguments: args }),
      close: () => client.close(),
    };
  };
}

/** Transport reale: MCP StreamableHTTP stateless verso il server condiviso. */
export class McpToolTransport implements SharedToolTransport {
  private readonly connector: SharedConnector;
  private connection: SharedConnection | null = null;
  private connecting: Promise<SharedConnection> | null = null;

  constructor(url: string, token: string, connector?: SharedConnector) {
    this.connector = connector ?? defaultConnector(url, token);
  }

  private ensureConnected(): Promise<SharedConnection> {
    if (this.connection) return Promise.resolve(this.connection);
    if (!this.connecting) {
      const attempt = this.connect(() => this.connecting === attempt);
      this.connecting = attempt;
      void attempt
        .finally(() => {
          if (this.connecting === attempt) this.connecting = null;
        })
        .catch(() => {});
    }
    return this.connecting;
  }

  private async connect(isCurrent: () => boolean): Promise<SharedConnection> {
    const connection = await this.connector();
    if (!isCurrent()) {
      // reset() (o un tentativo più recente) ha superato questa connessione
      // mentre era in corso: chiudila invece di far risorgere ref stale.
      await connection.close().catch(() => {});
      throw new SharedError('network', 'connection reset while connecting');
    }
    this.connection = connection;
    return connection;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const connection = await this.ensureConnected();
    return connection.callTool(name, args);
  }

  async reset(): Promise<void> {
    const connection = this.connection;
    this.connection = null;
    // Rende isCurrent() falso per ogni connect in-flight: un completamento
    // tardivo non deve resuscitare refs dopo il reset.
    this.connecting = null;
    if (connection) await connection.close().catch(() => {});
  }

  async close(): Promise<void> {
    await this.reset();
  }
}

/** Classifica un errore grezzo (SDK o transport) in SharedError. */
function classifyError(error: unknown): SharedError {
  if (error instanceof SharedError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (code === 401 || /unauthorized|401/i.test(message)) {
    return new SharedError('unauthorized', 'unauthorized — token revoked or invalid');
  }
  if (code === 429) return new SharedError('rate_limited', 'rate limited (100 req/min per token)');
  if (typeof code === 'number' && code >= 500) return new SharedError('server', `server error ${code}`);
  return new SharedError('network', message);
}

export class McpSharedClient implements SharedClient {
  private readonly config: {
    readonly serverUrl: string;
    readonly token: string;
    readonly timeoutMs: number;
    readonly maxRetries: number;
    readonly retryDelayMs: number;
  };
  private readonly transport: SharedToolTransport;

  constructor(config: SharedClientConfig, transport?: SharedToolTransport) {
    this.config = {
      serverUrl: config.serverUrl,
      token: config.token,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
      retryDelayMs: config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
    };
    this.transport = transport ?? new McpToolTransport(config.serverUrl, config.token);
  }

  search(queryText: string, limit?: number | undefined): Promise<Result<SharedSearchResult[], SharedError>> {
    const args: Record<string, unknown> = { query_text: queryText };
    if (limit !== undefined) args.limit = limit;
    return this.callWithRetry('shared_search', args, (text) => this.parseSearch(text));
  }

  publish(input: SharedPublishInput): Promise<Result<string, SharedError>> {
    const args: Record<string, unknown> = {
      level: input.level,
      visibility: input.visibility,
      content: input.content,
    };
    if (input.trustWeight !== undefined) args.trust_weight = input.trustWeight;
    if (input.workspaceId !== undefined) args.workspace_id = input.workspaceId;
    if (input.metadata !== undefined) args.metadata = input.metadata;
    // Publish non è idempotente lato server: un retry su failure ambigua
    // (network/timeout/5xx) rischierebbe un duplicato. Retry solo su 429,
    // dove la richiesta è arrivata ed è stata rifiutata.
    return this.callWithRetry('shared_publish', args, (text) => {
      try {
        const parsed = JSON.parse(text) as { id?: unknown };
        if (typeof parsed?.id !== 'string') {
          return err(new SharedError('malformed', 'shared_publish result missing id'));
        }
        return ok(parsed.id);
      } catch {
        return err(new SharedError('malformed', 'invalid JSON in shared_publish result'));
      }
    }, ONLY_RATE_LIMITED_RETRYABLE);
  }

  status(): Promise<Result<SharedStatus, SharedError>> {
    return this.callWithRetry('shared_status', {}, (text) => {
      try {
        const parsed = JSON.parse(text) as { items?: unknown; superseded?: unknown };
        if (typeof parsed?.items !== 'number') {
          return err(new SharedError('malformed', 'shared_status result missing items'));
        }
        return ok({
          items: parsed.items,
          superseded: typeof parsed.superseded === 'number' ? parsed.superseded : 0,
        });
      } catch {
        return err(new SharedError('malformed', 'invalid JSON in shared_status result'));
      }
    });
  }

  async close(): Promise<void> {
    await this.transport.close().catch(() => {});
  }

  // ─── Internals ────────────────────────────────────────────────

  private async withTimeout(promise: Promise<unknown>): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new SharedError('network', `timeout after ${this.config.timeoutMs}ms`)),
            this.config.timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async callWithRetry<T>(
    name: string,
    args: Record<string, unknown>,
    parse: (text: string) => Result<T, SharedError>,
    retryable: (kind: SharedErrorKind) => boolean = READ_RETRYABLE,
  ): Promise<Result<T, SharedError>> {
    let attempt = 0;
    for (;;) {
      try {
        const raw = await this.withTimeout(this.transport.callTool(name, args));
        const textResult = extractText(raw);
        if (!textResult.ok) {
          // isError tool results are retryable server failures (per policy)
          if (retryable(textResult.error.kind) && attempt < this.config.maxRetries) {
            attempt++;
            await delay(this.config.retryDelayMs * 2 ** (attempt - 1));
            await this.transport.reset().catch(() => {});
            continue;
          }
          return textResult;
        }
        return parse(textResult.value);
      } catch (error) {
        const sharedError = classifyError(error);
        if (retryable(sharedError.kind) && attempt < this.config.maxRetries) {
          attempt++;
          await delay(this.config.retryDelayMs * 2 ** (attempt - 1));
          await this.transport.reset().catch(() => {});
          continue;
        }
        return err(sharedError);
      }
    }
  }

  private parseSearch(text: string): Result<SharedSearchResult[], SharedError> {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!Array.isArray(parsed)) {
        return err(new SharedError('malformed', 'shared_search returned non-array payload'));
      }
      const results: SharedSearchResult[] = [];
      for (const entry of parsed) {
        const r = entry as {
          item?: {
            id?: unknown;
            content?: unknown;
            level?: unknown;
            visibility?: unknown;
            metadata?: unknown;
            trustWeight?: unknown;
            createdAt?: unknown;
            supersededAt?: unknown;
          };
          score?: unknown;
          matchType?: unknown;
        };
        if (typeof r?.item?.id !== 'string' || typeof r.item.content !== 'string') continue;
        if (r.item.supersededAt !== null && r.item.supersededAt !== undefined) continue;
        results.push({
          item: {
            id: r.item.id,
            content: r.item.content,
            level: typeof r.item.level === 'number' ? r.item.level : 0,
            visibility: r.item.visibility === 'team' ? 'team' : 'org',
            metadata: (r.item.metadata ?? {}) as Record<string, unknown>,
            trustWeight: typeof r.item.trustWeight === 'number' ? r.item.trustWeight : 0.5,
            createdAt: typeof r.item.createdAt === 'number' ? r.item.createdAt : 0,
            supersededAt: typeof r.item.supersededAt === 'number' ? r.item.supersededAt : null,
          },
          score: typeof r.score === 'number' ? r.score : 0,
          matchType: typeof r.matchType === 'string' ? r.matchType : 'hybrid',
        });
      }
      return ok(results);
    } catch {
      return err(new SharedError('malformed', 'invalid JSON in shared_search result'));
    }
  }
}

/** Estrae il primo content item di tipo text dal risultato grezzo del tool. */
function extractText(raw: unknown): Result<string, SharedError> {
  const result = raw as {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  } | null;
  if (result?.isError) {
    const detail = result.content?.find((c) => c.type === 'text')?.text ?? 'unknown tool error';
    return err(new SharedError('server', `tool error: ${detail}`));
  }
  const text = result?.content?.find((c) => c.type === 'text')?.text;
  if (typeof text !== 'string') {
    return err(new SharedError('malformed', 'tool result has no text content'));
  }
  return ok(text);
}
