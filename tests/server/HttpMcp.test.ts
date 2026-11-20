/**
 * The memory as an MCP server over HTTP (/mcp, stateless): initialize, list
 * tools, store and search, without a second database connection.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('HTTP MCP endpoint', () => {
  let server: ChildProcess;
  let port: number;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'omnimind-httpmcp-'));
    server = spawn('node', [join(process.cwd(), 'dist/server.js')], {
      env: { ...process.env, OMNIMIND_PORT: '0', OMNIMIND_SKIP_ADAPTERS: '1', OMNIMIND_DATA_DIR: dir, OMNIMIND_NAMESPACE: 'agent' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    port = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('start timeout')), 20000);
      server.stdout?.on('data', (d: Buffer) => {
        const m = d.toString().match(/Listening on http:\/\/(?:localhost|127\.0\.0\.1):(\d+)/);
        if (m) { clearTimeout(t); resolve(parseInt(m[1]!, 10)); }
      });
    });
    for (let i = 0; i < 60; i++) {
      const h = await fetch(`http://127.0.0.1:${port}/api/health`).then((r) => r.json()).catch(() => ({}));
      if ((h as { phase?: string }).phase === 'ready') break;
      await new Promise((r) => setTimeout(r, 500));
    }
  }, 60000);

  afterAll(() => {
    server.kill();
    rmSync(dir, { recursive: true, force: true });
  });

  const rpc = async (method: string, params: Record<string, unknown> = {}, id = 1) => {
    const r = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    return { status: r.status, body: await r.json() as Record<string, any> };
  };

  it('initializes, lists the tools, stores and finds a memory', async () => {
    const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'gateway', version: '1' } });
    expect(init.status).toBe(200);
    expect(init.body.result.serverInfo.name).toBe('omnimind');
    const tools = await rpc('tools/list', {}, 2);
    const names = (tools.body.result.tools as Array<{ name: string }>).map((t) => t.name);
    expect(names).toContain('omnimind_search');
    expect(names).toContain('omnimind_store');
    const stored = await rpc('tools/call', { name: 'omnimind_store', arguments: { content: 'Prefers offers as PDF', wing: 'personal' } }, 3);
    expect(stored.body.result.isError).toBeFalsy();
    const found = await rpc('tools/call', { name: 'omnimind_search', arguments: { query: 'offers PDF' } }, 4);
    expect(found.body.result.content[0].text).toContain('Prefers offers as PDF');
  }, 60000);

  it('refuses GET (stateless)', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/mcp`);
    expect(r.status).toBe(405);
  });
});
