/**
 * LLM endpoints integration tests — /api/llm, /api/llm/status, settings routing.
 *
 * Spawns the compiled server with OMNIMIND_DATA_DIR pointed at a temp dir,
 * so the persisted LLM settings are fully isolated from the real user
 * environment. Mirrors SetupEndpoints.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('LLM endpoints', () => {
  let server: ChildProcess;
  let port: number;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'omnimind-llm-ep-'));
    const serverPath = join(process.cwd(), 'dist/server.js');
    server = spawn('node', [serverPath], {
      env: {
        ...process.env,
        OMNIMIND_PORT: '0',
        OMNIMIND_SKIP_ADAPTERS: '1',
        OMNIMIND_DATA_DIR: dataDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('startup timeout')), 15000);
      server.stdout?.on('data', (d: Buffer) => {
        const m = d.toString().match(/Listening on http:\/\/(?:localhost|127\.0\.0\.1):(\d+)/);
        if (m) { clearTimeout(timer); resolve(parseInt(m[1]!, 10)); }
      });
      server.on('error', reject);
    });
    const deadline = Date.now() + 30000;
    for (;;) {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      const body = await res.json() as { status?: string };
      if (body.status === 'ok') break;
      if (Date.now() > deadline) throw new Error('server not ready');
      await new Promise((r) => setTimeout(r, 200));
    }
  }, 60000);

  afterAll(async () => {
    server.kill();
    await new Promise((r) => server.on('exit', r));
    rmSync(dataDir, { recursive: true, force: true });
  });

  const post = (key: string, value: string) =>
    fetch(`http://127.0.0.1:${port}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    }).then((r) => r.json());

  it('GET /api/llm returns a config + status shape with LLM disabled by default', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/llm`);
    const body = await res.json() as {
      config: { enabled: boolean; provider: string | null; model: string | null; baseUrl: string | null; timeoutMs: number };
      status: { provider: string; reachable: boolean; configured: boolean };
    };
    expect(body.config).toMatchObject({ enabled: false, provider: null, timeoutMs: 30000 });
    expect(body.status).toMatchObject({ configured: false, provider: 'null', reachable: false });
  });

  it('POST settings with llm keys persists and reloadLLM applies them', async () => {
    await post('llmEnabled', 'true');
    await post('llmProvider', 'ollama');
    await post('llmModel', 'qwen2.5:3b');
    const res = await fetch(`http://127.0.0.1:${port}/api/llm`);
    const body = await res.json() as { config: { enabled: boolean; provider: string | null } };
    expect(body.config.enabled).toBe(true);
    expect(body.config.provider).toBe('ollama');
  });

  it('GET /api/llm/status returns a live LLMStatus', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/llm/status`);
    const body = await res.json() as { configured: boolean; provider: string; reachable: boolean };
    expect(typeof body.configured).toBe('boolean');
    expect(['null', 'ollama', 'lmstudio']).toContain(body.provider);
    expect(typeof body.reachable).toBe('boolean');
  });
});
