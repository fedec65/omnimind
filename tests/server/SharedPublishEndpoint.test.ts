/**
 * Shared suggestions + publish endpoints.
 *
 * Seeds a real data dir through the Omnimind facade (memory L2 + suggestion
 * row + shared settings pointing at a fake MCP server), then spawns the
 * compiled server against the same data dir.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import { createServer, type Server as HttpServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { Omnimind } from '../../src/index.js';
import type { SharedToolTransport } from '../../src/shared/types.js';

/** Canned-response transport: no network during seeding. */
class FakeTransport implements SharedToolTransport {
  async callTool(): Promise<unknown> {
    throw new Error('FakeTransport: not used in seeding');
  }
  async reset(): Promise<void> {}
  async close(): Promise<void> {}
}

/** Minimal JSON-RPC responder sufficient for the MCP SDK handshake. */
function startFakeShared(): Promise<{ server: HttpServer; port: number }> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let rpc: { id?: number | string; method?: string } = {};
      try {
        rpc = JSON.parse(body);
      } catch {
        /* notification with empty body — ignore */
      }
      const respond = (result: unknown): void => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id ?? null, result }));
      };
      if (rpc.method === 'initialize') {
        respond({
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'fake-shared', version: '0.0.1' },
        });
      } else if (rpc.method === 'tools/call') {
        respond({ content: [{ type: 'text', text: '{"id":"shared-1"}' }], isError: false });
      } else {
        respond({}); // notifications/initialized, pings
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as AddressInfo).port });
    });
  });
}

describe('Shared suggestions + publish endpoints', () => {
  let server: ChildProcess;
  let port: number;
  let home: string;
  let dataDir: string;
  let fakeShared: HttpServer;
  let fakeSharedPort: number;
  let memoryId: string;

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'omnimind-sharedpub-home-'));
    dataDir = mkdtempSync(join(tmpdir(), 'omnimind-sharedpub-data-'));
    ({ server: fakeShared, port: fakeSharedPort } = await startFakeShared());

    // Seed via the facade: real memory L2 + real suggestion row + settings.
    const omni = await Omnimind.create({ dataDir, adapters: false, sharedTransport: new FakeTransport() });
    const stored = await omni.store('Promoted concept about testing', { wing: 'eng' });
    if (!stored.ok) throw new Error('seed store failed');
    const updated = await omni.memoryStore.update(stored.value.id, { layer: 2 });
    if (!updated.ok) throw new Error('seed update failed');
    (omni as unknown as { noteSharedSuggestion(m: unknown): void }).noteSharedSuggestion(updated.value);
    memoryId = stored.value.id;
    omni.setSetting('sharedEnabled', 'true');
    omni.setSetting('sharedServerUrl', `http://127.0.0.1:${fakeSharedPort}/mcp`);
    omni.setSetting('sharedToken', 'omt_test_token');
    await omni.close();

    server = spawn('node', [join(process.cwd(), 'dist/server.js')], {
      env: {
        ...process.env,
        OMNIMIND_PORT: '0',
        OMNIMIND_SKIP_ADAPTERS: '1',
        OMNIMIND_DATA_DIR: dataDir,
        HOME: home,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    port = await new Promise<number>((resolve, reject) => {
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
  }, 120000);

  afterAll(async () => {
    server?.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    fakeShared.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  const get = async (p: string) => {
    const res = await fetch(`http://localhost:${port}${p}`);
    return { status: res.status, data: await res.json() };
  };

  const post = async (p: string, body: unknown) => {
    const res = await fetch(`http://localhost:${port}${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json() };
  };

  it('GET /api/shared/suggestions lists the seeded pending suggestion', async () => {
    const { status, data } = await get('/api/shared/suggestions');
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(1);
    expect(data[0].memoryId).toBe(memoryId);
    expect(data[0].level).toBe(2);
    expect(data[0].content).toContain('Promoted concept');
  });

  it('POST /api/shared/publish rejects an invalid visibility with 400', async () => {
    const { status, data } = await post('/api/shared/publish', { id: memoryId, visibility: 'public' });
    expect(status).toBe(400);
    expect(data.error).toBeDefined();
  });

  it('POST /api/shared/publish returns 404 for a missing memory id', async () => {
    const { status, data } = await post('/api/shared/publish', {
      id: '00000000-0000-0000-0000-000000000000',
      visibility: 'org',
    });
    expect(status).toBe(404);
    expect(data.error).toContain('Memory not found');
  });

  it('POST /api/shared/publish publishes and removes the suggestion', async () => {
    const { status, data } = await post('/api/shared/publish', { id: memoryId, visibility: 'org' });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.sharedId).toBe('shared-1');

    // The pending list is now empty and the DB row is gone (not just filtered)
    const after = await get('/api/shared/suggestions');
    expect(after.data).toHaveLength(0);
    const db = new Database(join(dataDir, 'memory.db'), { readonly: true, fileMustExist: true });
    const rows = db.prepare('SELECT COUNT(*) AS n FROM shared_suggestions').get() as { n: number };
    db.close();
    expect(rows.n).toBe(0);
  });
});
