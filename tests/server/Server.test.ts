/**
 * HTTP API Server integration tests
 *
 * Tests the REST endpoints exposed by src/server.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import { join } from 'path';
import type { ChildProcess } from 'child_process';

describe('HTTP Server', () => {
  let server: ChildProcess;
  let port: number;

  beforeAll(async () => {
    const serverPath = join(process.cwd(), 'dist/server.js');
    server = spawn('node', [serverPath], {
      env: { ...process.env, OMNIMIND_PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Wait for ready signal
    port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server startup timeout')), 15000);
      server.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        const match = text.match(/Listening on http:\/\/localhost:(\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(parseInt(match[1], 10));
        }
      });
      server.stderr?.on('data', (data: Buffer) => {
        console.error('[Server stderr]', data.toString());
      });
      server.on('error', reject);
    });
  });

  afterAll(() => {
    server.kill();
  });

  async function fetchApi(path: string, init?: RequestInit) {
    const res = await fetch(`http://localhost:${port}${path}`, init);
    if (res.status === 204) return null;
    return res.json();
  }

  it('should return health status', async () => {
    const data = await fetchApi('/api/health');
    expect(data.status).toBe('ok');
    expect(data.version).toBe('0.4.2');
  });

  it('should create and retrieve a memory', async () => {
    const create = await fetchApi('/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Test GUI memory', wing: 'gui-test' }),
    });
    expect(create.memory).toBeDefined();
    expect(create.memory.wing).toBe('gui-test');

    const get = await fetchApi(`/api/memories/${create.memory.id}`);
    expect(get.memory.content).toBe('Test GUI memory');
  });

  it('should search memories', async () => {
    const data = await fetchApi('/api/search?q=GUI&limit=5');
    expect(Array.isArray(data.results)).toBe(true);
  });

  it('should return stats', async () => {
    const data = await fetchApi('/api/stats');
    expect(data.predictor).toBeDefined();
    expect(data.bus).toBeDefined();
  });

  it('should return 404 for unknown routes', async () => {
    const res = await fetch(`http://localhost:${port}/api/unknown`);
    expect(res.status).toBe(404);
  });
});
