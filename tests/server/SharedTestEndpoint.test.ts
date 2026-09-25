/**
 * Shared connectivity test endpoint — POST /api/shared/test.
 *
 * The POST variant accepts an optional {url, token} body and tests those
 * credentials ad-hoc (no save side-effect); without a body it behaves like
 * the GET path (persisted settings).
 *
 * Spawns the compiled server with HOME and OMNIMIND_DATA_DIR pointed at temp
 * dirs, and stands up a tiny fake shared server to observe connection attempts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import { createServer, type Server as HttpServer, type IncomingMessage } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('POST /api/shared/test', () => {
  let server: ChildProcess;
  let port: number;
  let home: string;
  let dataDir: string;

  let fakeShared: HttpServer;
  let fakeSharedPort: number;
  const fakeSharedRequests: IncomingMessage[] = [];

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'omnimind-sharedtest-home-'));
    dataDir = mkdtempSync(join(tmpdir(), 'omnimind-sharedtest-data-'));

    // Fake shared server: records every request and answers 401 so the MCP
    // client fails fast. Receiving a request proves the ad-hoc client reached
    // this URL (i.e. it used the body values, not the persisted settings).
    fakeShared = createServer((req, res) => {
      fakeSharedRequests.push(req);
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
    });
    await new Promise<void>((resolve) => fakeShared.listen(0, '127.0.0.1', resolve));
    fakeSharedPort = (fakeShared.address() as AddressInfo).port;

    const serverPath = join(process.cwd(), 'dist/server.js');
    server = spawn('node', [serverPath], {
      env: {
        ...process.env,
        OMNIMIND_PORT: '0',
        OMNIMIND_SKIP_ADAPTERS: '1',
        OMNIMIND_DATA_DIR: dataDir,
        HOME: home,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server startup timeout')), 15000);
      server.stdout?.on('data', (data: Buffer) => {
        const match = data.toString().match(/Listening on http:\/\/(?:localhost|127\.0\.0\.1):(\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(parseInt(match[1], 10));
        }
      });
      server.on('error', reject);
    });

    const deadline = Date.now() + 30000;
    for (;;) {
      try {
        const res = await fetch(`http://localhost:${port}/api/health`);
        const health = await res.json();
        if (health.status === 'ok') break;
        if (health.status === 'failed') throw new Error('Server initialization failed');
      } catch (e) {
        if (e instanceof Error && e.message === 'Server initialization failed') throw e;
      }
      if (Date.now() > deadline) throw new Error('Server ready timeout');
      await new Promise((r) => setTimeout(r, 500));
    }
  }, 60000);

  afterAll(async () => {
    server?.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    fakeShared.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  const post = async (p: string, body?: unknown) => {
    const res = await fetch(`http://localhost:${port}${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, data: await res.json() };
  };

  it('POST without a body behaves like GET (persisted settings, "not configured" here)', async () => {
    const getRes = await fetch(`http://localhost:${port}/api/shared/test`);
    const getData = await getRes.json();
    const { status, data } = await post('/api/shared/test');
    expect(status).toBe(200);
    expect(data).toEqual(getData);
    expect(data.connected).toBe(false);
    expect(data.reason).toBe('not configured');
  });

  it('POST with a valid body tests those credentials ad-hoc (no persisted settings needed)', async () => {
    // Bogus persisted settings: if the endpoint read them it would never reach
    // the fake shared server (this URL refuses connections).
    await post('/api/settings', { key: 'sharedServerUrl', value: 'http://127.0.0.1:1/' });
    await post('/api/settings', { key: 'sharedToken', value: 'omt_persisted_token' });

    const before = fakeSharedRequests.length;
    const token = 'omt_body_token_123';
    const { status, data } = await post('/api/shared/test', {
      url: `http://127.0.0.1:${fakeSharedPort}/mcp`,
      token,
    });

    expect(status).toBe(200);
    expect(data.connected).toBe(false);
    expect(fakeSharedRequests.length).toBeGreaterThan(before);
    const auth = fakeSharedRequests[fakeSharedRequests.length - 1]?.headers.authorization;
    expect(auth).toBe(`Bearer ${token}`);
  });

  it('POST with only url uses the persisted token (masked-token form flow)', async () => {
    // Persist a token only; the body supplies the (edited) URL. The saved
    // token must be paired with the body URL — exactly what the GUI needs
    // when the token field shows the '***' mask.
    await post('/api/settings', { key: 'sharedToken', value: 'omt_persisted_token' });

    const before = fakeSharedRequests.length;
    const { status, data } = await post('/api/shared/test', {
      url: `http://127.0.0.1:${fakeSharedPort}/mcp`,
    });

    expect(status).toBe(200);
    expect(data.connected).toBe(false);
    expect(fakeSharedRequests.length).toBeGreaterThan(before);
    const auth = fakeSharedRequests[fakeSharedRequests.length - 1]?.headers.authorization;
    expect(auth).toBe('Bearer omt_persisted_token');
  });

  it('POST with only url and no persisted token returns 400', async () => {
    // Clear the persisted token saved by the previous test
    await post('/api/settings', { key: 'sharedToken', value: '' });

    const { status, data } = await post('/api/shared/test', { url: 'http://127.0.0.1:9999/mcp' });
    expect(status).toBe(400);
    expect(data.error).toBeDefined();
  });

  it('POST with only token returns 400', async () => {
    const { status, data } = await post('/api/shared/test', { token: 'omt_only_token' });
    expect(status).toBe(400);
    expect(data.error).toBeDefined();
  });

  it('POST with a non-http(s) url returns 400', async () => {
    const { status, data } = await post('/api/shared/test', {
      url: 'ftp://example.com/mcp',
      token: 'omt_token',
    });
    expect(status).toBe(400);
    expect(data.error).toBeDefined();
  });

  it('POST with an unparsable url returns 400', async () => {
    const { status, data } = await post('/api/shared/test', { url: 'not a url', token: 'omt_token' });
    expect(status).toBe(400);
    expect(data.error).toBeDefined();
  });
});
