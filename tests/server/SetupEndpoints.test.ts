/**
 * Setup endpoints integration tests — /api/setup/*.
 *
 * Spawns the compiled server with HOME and OMNIMIND_DATA_DIR pointed at a
 * temp dir, so client configs and the memory DB are fully isolated from
 * the real user environment.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Setup endpoints', () => {
  let server: ChildProcess;
  let port: number;
  let home: string;
  let dataDir: string;

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'omnimind-setup-home-'));
    dataDir = mkdtempSync(join(tmpdir(), 'omnimind-setup-data-'));
    mkdirSync(join(home, '.cursor'), { recursive: true });

    const serverPath = join(process.cwd(), 'dist/server.js');
    server = spawn('node', [serverPath], {
      env: {
        ...process.env,
        OMNIMIND_PORT: '0',
        OMNIMIND_SKIP_ADAPTERS: '1',
        OMNIMIND_DATA_DIR: dataDir,
        OMNIMIND_CLI_TARGETS: join(home, 'bin'),
        HOME: home,
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
  }, 60000);

  afterAll(async () => {
    server?.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    rmSync(home, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  const get = async (p: string) => (await fetch(`http://localhost:${port}${p}`)).json();
  const post = async (p: string, body: unknown) =>
    (
      await fetch(`http://localhost:${port}${p}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    ).json();

  it('GET /api/setup/clients reports detected Cursor and not-detected others', async () => {
    const res = await get('/api/setup/clients');
    const byId = new Map(res.clients.map((c: { id: string }) => [c.id, c]));
    expect(byId.get('cursor')).toMatchObject({ detected: true, configured: false });
    expect(byId.get('kimi')).toMatchObject({ detected: false, configured: false });
    expect(res.cli.installed).toBeNull();
  });

  it('POST /api/setup/register writes an explicit entry into detected clients', async () => {
    const res = await post('/api/setup/register', {});
    expect(res.registered.map((r: { id: string }) => r.id)).toEqual(['cursor']);

    const cfg = JSON.parse(readFileSync(join(home, '.cursor', 'mcp.json'), 'utf8'));
    expect(cfg.mcpServers.omnimind.command).toBe(process.execPath);
    expect(cfg.mcpServers.omnimind.args[0]).toContain('mcp-server.js');

    const byId = new Map(res.clients.map((c: { id: string }) => [c.id, c]));
    expect(byId.get('cursor')).toMatchObject({ configured: true });
  });

  it('POST /api/setup/register honors an explicit client list', async () => {
    const res = await post('/api/setup/register', { clients: ['kimi'] });
    expect(res.registered.map((r: { id: string }) => r.id)).toEqual(['kimi']);
    const cfg = JSON.parse(readFileSync(join(home, '.kimi-code', 'mcp.json'), 'utf8'));
    expect(cfg.mcpServers.omnimind).toBeDefined();
  });

  it('POST /api/setup/register rejects unknown clients', async () => {
    const res = await post('/api/setup/register', { clients: ['emacs'] });
    expect(res.error).toContain('Unknown clients');
  });

  it('POST /api/setup/install-cli writes the wrapper into the temp target', async () => {
    const res = await post('/api/setup/install-cli', {});
    expect(res.ok).toBe(true);
    expect(res.path).toBe(join(home, 'bin', 'omnimind'));

    // And now the status endpoint reports it as installed
    const status = await get('/api/setup/clients');
    expect(status.cli.installed).toBe(join(home, 'bin', 'omnimind'));
  });
});
