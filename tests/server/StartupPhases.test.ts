/**
 * Startup phases test — the server listens immediately and reports
 * initialization progress via /api/health ('starting' → 'ok'), while
 * other endpoints return 503 until the engine is ready.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Server startup phases', () => {
  let server: ChildProcess;
  let port: number;
  let dataDir: string;
  let sawStarting = false;
  let guardedDuringStart = false;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'omnimind-startup-test-'));
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
      const timer = setTimeout(() => reject(new Error('Server startup timeout')), 15000);
      server.stdout?.on('data', (data: Buffer) => {
        const match = data.toString().match(/Listening on http:\/\/localhost:(\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(parseInt(match[1], 10));
        }
      });
      server.on('error', reject);
    });

    // Poll from the very beginning to observe the starting window
    const deadline = Date.now() + 30000;
    for (;;) {
      const healthRes = await fetch(`http://localhost:${port}/api/health`);
      const health = await healthRes.json();

      if (health.status === 'starting') {
        sawStarting = true;
        if (typeof health.phase !== 'string') throw new Error('starting status must carry a phase');
        // While starting, other endpoints must be guarded
        const statsRes = await fetch(`http://localhost:${port}/api/stats`);
        if (statsRes.status === 503) {
          const body = await statsRes.json();
          if (body.error?.includes('starting')) guardedDuringStart = true;
        }
      }

      if (health.status === 'ok') break;
      if (health.status === 'failed') throw new Error('Server initialization failed');
      if (Date.now() > deadline) throw new Error('Server ready timeout');
      await new Promise((r) => setTimeout(r, 100));
    }
  }, 60000);

  afterAll(async () => {
    server?.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('reaches status ok with a version', async () => {
    const res = await fetch(`http://localhost:${port}/api/health`);
    const health = await res.json();
    expect(health.status).toBe('ok');
    expect(typeof health.version).toBe('string');
    expect(health.phase).toBe('ready');
  });

  it('reported starting with a phase and guarded endpoints with 503', () => {
    // Engine init (embedding model load) reliably takes long enough to
    // observe the starting window; if a future machine is too fast, these
    // flags would need a deterministic slowdown hook instead.
    expect(sawStarting).toBe(true);
    expect(guardedDuringStart).toBe(true);
  });

  it('serves endpoints normally once ready', async () => {
    const res = await fetch(`http://localhost:${port}/api/stats`);
    expect(res.status).toBe(200);
  });
});
