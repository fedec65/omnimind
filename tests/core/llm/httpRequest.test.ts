import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server as HttpServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { httpRequest } from '../../../src/core/llm/httpRequest.js';

interface Handler {
  (req: IncomingMessage, body: string): { status: number; payload: string };
}

let server: HttpServer;
let baseUrl: string;
let lastHandler: Handler | undefined;
let seen: string[];

beforeEach(async () => {
  seen = [];
  lastHandler = undefined;
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      seen.push(`${req.method} ${req.url}`);
      const handler = lastHandler;
      if (!handler) {
        res.statusCode = 500;
        res.end('no handler');
        return;
      }
      const { status, payload } = handler(req, body);
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(payload);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('httpRequest', () => {
  it('POSTs JSON, parses JSON response, returns ok(200, value)', async () => {
    lastHandler = (_req, body) => ({
      status: 200,
      payload: JSON.stringify({ echoed: JSON.parse(body) }),
    });
    const result = await httpRequest({
      url: baseUrl + '/v1/chat',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { prompt: 'hi' },
      timeoutMs: 1000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ echoed: { prompt: 'hi' } });
    expect(seen.at(-1)).toBe('POST /v1/chat');
  });

  it('returns err response with status and body on non-2xx', async () => {
    lastHandler = () => ({ status: 404, payload: '{"error":"missing model"}' });
    const result = await httpRequest({
      url: baseUrl + '/missing',
      method: 'POST',
      body: { x: 1 },
      timeoutMs: 1000,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('response');
    if (result.error.kind !== 'response') return;
    expect(result.error.status).toBe(404);
    expect(result.error.body).toBe('{"error":"missing model"}');
  });

  it('returns err unavailable on connection refused', async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const result = await httpRequest({
      url: 'http://127.0.0.1:1/dead',
      method: 'POST',
      body: { x: 1 },
      timeoutMs: 500,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unavailable');
  });

  it('returns err aborted when AbortSignal is triggered', async () => {
    lastHandler = () => ({ status: 200, payload: '{}' });
    const ac = new AbortController();
    const promise = httpRequest({
      url: baseUrl + '/slow',
      method: 'POST',
      body: { x: 1 },
      timeoutMs: 5000,
      signal: ac.signal,
    });
    ac.abort();
    const result = await promise;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('aborted');
  });

  it('silently treats malformed JSON body as ok with undefined value', async () => {
    lastHandler = () => ({ status: 200, payload: 'not json {{{' });
    const result = await httpRequest({
      url: baseUrl + '/bad-json',
      method: 'POST',
      body: { x: 1 },
      timeoutMs: 1000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeUndefined();
  });

  it('serializes body as JSON and sends content-type when not provided', async () => {
    let captured: string | undefined;
    let capturedCT: string | undefined;
    lastHandler = (req, body) => {
      captured = body;
      capturedCT = req.headers['content-type'];
      return { status: 200, payload: '{}' };
    };
    const result = await httpRequest({
      url: baseUrl + '/auto',
      method: 'POST',
      body: { a: 1, b: 'two' },
      timeoutMs: 1000,
    });
    expect(result.ok).toBe(true);
    expect(captured).toBe('{"a":1,"b":"two"}');
    expect(capturedCT).toBe('application/json');
  });
});
