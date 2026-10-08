import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LMStudioProvider } from '../../../src/core/llm/LMStudioProvider.js';

let server: HttpServer;
let base: string;
let chatBody: unknown = null;
let chatStatus = 200;
let chatJson: unknown = { choices: [{ message: { content: 'lm summary' } }] };
let modelsStatus = 200;
let modelsJson: unknown = { data: [{ id: 'autodetect-model' }] };

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      if (req.url === '/v1/chat/completions') {
        chatBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        res.writeHead(chatStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(chatJson));
      } else if (req.url === '/v1/models') {
        res.writeHead(modelsStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(modelsJson));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end('{}');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function make(model = 'my-model'): LMStudioProvider {
  return new LMStudioProvider({ provider: 'lmstudio', baseUrl: base, model, timeoutMs: 5000 });
}

describe('LMStudioProvider', () => {
  it('reports its name and isConfigured', () => {
    const p = make();
    expect(p.name).toBe('lmstudio');
    expect(p.isConfigured()).toBe(true);
  });

  it('summarize posts an OpenAI-compatible body and returns choices[0].message.content', async () => {
    chatStatus = 200;
    chatJson = { choices: [{ message: { content: 'lm summary' } }] };
    const r = await make().summarize('the text', { maxWords: 30 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('lm summary');
    const c = chatBody as { model: string; max_tokens: number; temperature: number; stream: boolean; messages: Array<{ role: string; content: string }> };
    expect(c.model).toBe('my-model');
    expect(c.max_tokens).toBe(60);
    expect(c.temperature).toBe(0.2);
    expect(c.stream).toBe(false);
    expect(c.messages[1]).toEqual({ role: 'user', content: 'the text' });
  });

  it('health autodetects and caches the model from /models', async () => {
    modelsStatus = 200;
    modelsJson = { data: [{ id: 'autodetect-model' }] };
    const r = await make().health();
    expect(r.ok).toBe(true);
    expect((chatBody as { model?: string }).model).toBe('my-model');
  });

  it('health does not overwrite an explicitly configured model', async () => {
    modelsJson = { data: [{ id: 'other-model' }] };
    const p = make('explicit-model');
    const r = await p.health();
    expect(r.ok).toBe(true);
    const summary = await p.summarize('hi');
    expect(summary.ok).toBe(true);
    if (summary.ok) expect(summary.value).toBe('lm summary');
    expect((chatBody as { model?: string }).model).toBe('explicit-model');
  });

  it('summarize autodetects model when none is configured', async () => {
    chatBody = null;
    chatJson = { choices: [{ message: { content: 'autodetected summary' } }] };
    modelsJson = { data: [{ id: 'autodetect-model' }] };
    const p = make('');
    const r = await p.summarize('hello');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('autodetected summary');
    expect((chatBody as { model?: string }).model).toBe('autodetect-model');
  });

  it('summarize returns config error when no model is configured and /models is empty', async () => {
    modelsJson = { data: [] };
    const p = make('');
    const r = await p.summarize('hello');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('config');
  });

  it('returns response error on non-2xx', async () => {
    chatStatus = 503;
    chatJson = { error: 'model loading' };
    const r = await make().summarize('hi');
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === 'response') expect(r.error.status).toBe(503);
  });
});