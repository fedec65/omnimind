import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OllamaProvider } from '../../../src/core/llm/OllamaProvider.js';

const SYSTEM_PROMPT =
  "You are a local memory assistant. Summarize the user's text in N words. Preserve concrete details: filenames, function names, error messages, exact decisions. Do not add information that is not in the text. Respond with the summary only.";

let server: HttpServer;
let base: string;
let chatBody: unknown = null;
let chatStatus = 200;
let chatJson: unknown = { message: { content: 'summary' } };
let tagsStatus = 200;
let tagsJson: unknown = { models: [{ name: 'qwen2.5:3b' }] };

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (req.url === '/api/chat' && req.method === 'POST') {
        chatBody = raw ? JSON.parse(raw) : null;
        res.statusCode = chatStatus;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(chatJson));
        return;
      }
      if (req.url === '/api/tags' && req.method === 'GET') {
        res.statusCode = tagsStatus;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(tagsJson));
        return;
      }
      res.statusCode = 404;
      res.end('not found');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function make(): OllamaProvider {
  return new OllamaProvider({ provider: 'ollama', baseUrl: base, model: 'qwen2.5:3b', timeoutMs: 5000 });
}

describe('OllamaProvider', () => {
  it('reports its name and isConfigured', () => {
    const p = make();
    expect(p.name).toBe('ollama');
    expect(p.isConfigured()).toBe(true);
  });

  it('summarize posts the expected body and returns the message content', async () => {
    chatStatus = 200;
    chatJson = { message: { content: 'the summary here' } };
    const r = await make().summarize('some long text', { maxWords: 40 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('the summary here');
    const c = chatBody as { model: string; messages: Array<{ role: string; content: string }>; stream: boolean; options: { num_predict: number } };
    expect(c.model).toBe('qwen2.5:3b');
    expect(c.stream).toBe(false);
    expect(c.options.num_predict).toBe(80);
    expect(c.messages[0].role).toBe('system');
    expect(c.messages[0].content).toBe(SYSTEM_PROMPT);
    expect(c.messages[1]).toEqual({ role: 'user', content: 'some long text' });
  });

  it('returns response error when Ollama has not pulled the model', async () => {
    chatStatus = 404;
    chatJson = { error: "model 'qwen2.5:3b' not found, try pulling it first" };
    const r = await make().summarize('hello');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('response');
      if (r.error.kind === 'response') expect(r.error.status).toBe(404);
    }
  });

  it('health returns ok when the model is present', async () => {
    tagsStatus = 200;
    tagsJson = { models: [{ name: 'qwen2.5:3b' }] };
    const r = await make().health();
    expect(r.ok).toBe(true);
  });

  it('health returns model-not-pulled when the model is missing', async () => {
    tagsStatus = 200;
    tagsJson = { models: [{ name: 'llama3.2:3b' }] };
    const r = await make().health();
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === 'response') expect(r.error.body).toBe('model not pulled');
  });
});
