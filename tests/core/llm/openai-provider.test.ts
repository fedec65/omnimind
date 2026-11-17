import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OpenAICompatibleProvider } from '../../../src/core/llm/OpenAICompatibleProvider.js';

describe('OpenAICompatibleProvider (company gateway, person\'s own key)', () => {
  let server: Server;
  let base: string;
  const seen: Array<{ path: string; auth: string | undefined; body: string }> = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({ path: req.url ?? '', auth: req.headers.authorization, body });
        res.setHeader('content-type', 'application/json');
        if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'MiniMax-M3.1-Flash' }] }));
        res.end(JSON.stringify({ choices: [{ message: { content: '<think>plan</think>\nThe office moves in December.' } }] }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });
  afterAll(() => server.close());

  it('sends the key, the model and strips reasoning from the answer', async () => {
    const p = new OpenAICompatibleProvider({ provider: 'openai', baseUrl: base, model: 'MiniMax-M3.1-Flash', timeoutMs: 5000, apiKey: 'sk-person' });
    expect(p.isConfigured()).toBe(true);
    const r = await p.summarize('A long note about the Zurich office moving to the new floor in December.', { maxWords: 20 });
    expect(r.ok && r.value).toBe('The office moves in December.');
    const call = seen.find((s) => s.path === '/v1/chat/completions')!;
    expect(call.auth).toBe('Bearer sk-person');
    expect(JSON.parse(call.body).model).toBe('MiniMax-M3.1-Flash');
    expect((await p.health()).ok).toBe(true);
  });

  it('is not configured without a key', () => {
    const p = new OpenAICompatibleProvider({ provider: 'openai', baseUrl: base, model: 'm', timeoutMs: 1000 });
    expect(p.isConfigured()).toBe(false);
  });
});
