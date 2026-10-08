/**
 * Minimal node:http JSON request helper for local LLM providers.
 * Built on top of the stdlib to avoid pulling in undici/fetch globals
 * (Node 18 still ships http without the experimental fetch surface in
 * the test runner we use). All outcomes are returned as Result; callers
 * pattern-match on `kind` instead of catching exceptions.
 */
import { request as httpRequestImpl } from 'node:http';
import { request as httpsRequestImpl } from 'node:https';
import type { RequestOptions } from 'node:http';
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
  /** Hard deadline in ms. Triggers `unavailable` if exceeded. */
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

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return Promise.resolve(err({ kind: 'config', reason: `protocol must be http(s), got ${parsed.protocol}` }));
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
  };

  return new Promise<Result<unknown, LLMError>>((resolve) => {
    let settled = false;
    let responseEnded = false;
    const settle = (r: Result<unknown, LLMError>): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (abortHandler && opts.signal) {
        opts.signal.removeEventListener('abort', abortHandler);
      }
      resolve(r);
    };

    const deadline = setTimeout(() => {
      req.destroy();
      settle(err({ kind: 'unavailable', cause: `timeout after ${opts.timeoutMs}ms` }));
    }, opts.timeoutMs);

    const doRequest = parsed.protocol === 'https:' ? httpsRequestImpl : httpRequestImpl;

    let abortHandler: (() => void) | undefined;

    const req = doRequest(reqOpts, (res) => {
      let chunks = '';
      res.setEncoding('utf8');

      const onPrematureClose = (reason: string): void => {
        if (responseEnded) return;
        settle(err({ kind: 'unavailable', cause: reason }));
      };

      res.on('data', (chunk: string) => {
        chunks += chunk;
      });

      res.on('end', () => {
        responseEnded = true;
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          settle(err({ kind: 'response', status, body: chunks }));
          return;
        }
        settle(ok(parseJson(chunks)));
      });

      res.on('error', (e: Error) => {
        onPrematureClose(`response error: ${e.message}`);
      });

      res.on('aborted', () => {
        onPrematureClose('response aborted');
      });

      res.on('close', () => {
        onPrematureClose('response closed before end');
      });
    });

    req.on('error', (e: Error) => {
      settle(err({ kind: 'unavailable', cause: e.message }));
    });

    if (opts.signal) {
      if (opts.signal.aborted) {
        req.destroy();
        settle(err({ kind: 'aborted' }));
        return;
      }
      abortHandler = () => {
        req.destroy();
        settle(err({ kind: 'aborted' }));
      };
      opts.signal.addEventListener('abort', abortHandler, { once: true });
    }

    if (hasBody && bodyText !== undefined) {
      req.write(bodyText);
    }
    req.end();
  });
}
