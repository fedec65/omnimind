/**
 * Minimal node:http JSON request helper for local LLM providers.
 * Built on top of the stdlib to avoid pulling in undici/fetch globals
 * (Node 18 still ships http without the experimental fetch surface in
 * the test runner we use). All outcomes are returned as Result; callers
 * pattern-match on `kind` instead of catching exceptions.
 */
import { request, type RequestOptions } from 'node:http';
import { URL } from 'node:url';
import { type Result, ok, err } from '../types.js';
import type { LLMError } from './errors.js';

/** Outgoing JSON request. */
export interface HttpRequestOptions {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  /** JSON-serializable payload. `undefined` sends no body (e.g. GET). */
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  /** Hard timeout in ms. Triggers `unavailable` if exceeded. */
  readonly timeoutMs: number;
  /** External cancellation (e.g. AbortSignal from a CLI handler). */
  readonly signal?: AbortSignal | undefined;
}

function parseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function httpRequest(
  opts: HttpRequestOptions,
): Promise<Result<unknown, LLMError>> {
  let parsed: URL;
  try {
    parsed = new URL(opts.url);
  } catch {
    return Promise.resolve(err({ kind: 'config', reason: `invalid URL: ${opts.url}` }));
  }

  const hasBody = opts.body !== undefined;
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  const hasContentType = Object.keys(headers).some((k) => k.toLowerCase() === 'content-type');
  let bodyText: string | undefined;
  if (hasBody) {
    bodyText = JSON.stringify(opts.body);
    if (!hasContentType) {
      headers['content-type'] = 'application/json';
    }
    headers['content-length'] = Buffer.byteLength(bodyText).toString();
  }

  const reqOpts: RequestOptions = {
    method: opts.method,
    hostname: parsed.hostname,
    port: parsed.port || undefined,
    path: `${parsed.pathname}${parsed.search}`,
    headers,
    timeout: opts.timeoutMs,
  };

  return new Promise<Result<unknown, LLMError>>((resolve) => {
    let settled = false;
    const settle = (r: Result<unknown, LLMError>): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    const req = request(reqOpts, (res) => {
      let chunks = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        chunks += chunk;
      });
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          settle(err({ kind: 'response', status, body: chunks }));
          return;
        }
        settle(ok(parseJson(chunks)));
      });
    });

    req.on('error', (e: Error) => {
      settle(err({ kind: 'unavailable', cause: e.message }));
    });

    req.on('timeout', () => {
      req.destroy();
      settle(err({ kind: 'unavailable', cause: `timeout after ${opts.timeoutMs}ms` }));
    });

    if (opts.signal) {
      if (opts.signal.aborted) {
        req.destroy();
        settle(err({ kind: 'aborted' }));
        return;
      }
      opts.signal.addEventListener(
        'abort',
        () => {
          req.destroy();
          settle(err({ kind: 'aborted' }));
        },
        { once: true },
      );
    }

    if (hasBody && bodyText !== undefined) {
      req.write(bodyText);
    }
    req.end();
  });
}
