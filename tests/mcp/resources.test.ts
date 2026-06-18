/**
 * MCP resource handler tests.
 *
 * Exercises the 5 read resources (predictions, stats/overview,
 * memories/recent, entities/list, relations/list) plus the unknown-URI
 * error path. Calls the private `handleReadResource` directly to
 * bypass the MCP SDK transport.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { OmnimindMcpServer } from '../../src/mcp/server.js';
import { MemoryStore } from '../../src/core/MemoryStore.js';

describe('MCP server — resources', () => {
  let tmpDir: string;
  let store: MemoryStore;
  let server: OmnimindMcpServer;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omnimind-mcp-res-'));
    store = new MemoryStore({ dbPath: join(tmpDir, 'test.db') });
    await store.init();

    server = new OmnimindMcpServer();
    (server as any).store = store;
    (server as any).clientNamespace = 'ag-testclient';
  });

  afterEach(async () => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('omnimind://stats/overview returns the stats payload', async () => {
    const result = await (server as any).handleReadResource('omnimind://stats/overview');
    const payload = JSON.parse(result.contents[0].text);
    expect(payload.memories).toBeDefined();
    expect(payload.bus).toBeDefined();
    expect(payload.predictor).toBeDefined();
  });

  it('omnimind://memories/recent returns the 3 seeded memories in descending order', async () => {
    const handleStore = (server as any).handleStore.bind(server);
    await handleStore({ content: 'first memory', wing: 'general' });
    await new Promise((r) => setTimeout(r, 5));
    await handleStore({ content: 'second memory', wing: 'general' });
    await new Promise((r) => setTimeout(r, 5));
    await handleStore({ content: 'third memory', wing: 'general' });

    const result = await (server as any).handleReadResource('omnimind://memories/recent');
    const payload = JSON.parse(result.contents[0].text);
    expect(payload.count).toBe(3);
    expect(payload.memories[0].content).toBe('third memory');
    expect(payload.memories[2].content).toBe('first memory');
    expect(payload.namespace).toBe('ag-testclient');
  });

  it('omnimind://memories/recent?limit=1 returns exactly 1 memory', async () => {
    const handleStore = (server as any).handleStore.bind(server);
    await handleStore({ content: 'one', wing: 'general' });
    await new Promise((r) => setTimeout(r, 5));
    await handleStore({ content: 'two', wing: 'general' });

    const result = await (server as any).handleReadResource(
      'omnimind://memories/recent?limit=1',
    );
    const payload = JSON.parse(result.contents[0].text);
    expect(payload.count).toBe(1);
  });

  it('omnimind://memories/recent?namespace=other returns 0 memories', async () => {
    const handleStore = (server as any).handleStore.bind(server);
    await handleStore({ content: 'private memory', wing: 'general' });

    const result = await (server as any).handleReadResource(
      'omnimind://memories/recent?namespace=other',
    );
    const payload = JSON.parse(result.contents[0].text);
    expect(payload.count).toBe(0);
    expect(payload.namespace).toBe('other');
  });

  it('omnimind://entities/list returns a non-error payload', async () => {
    const result = await (server as any).handleReadResource('omnimind://entities/list');
    const payload = JSON.parse(result.contents[0].text);
    expect(payload.count).toBeDefined();
    expect(Array.isArray(payload.entities)).toBe(true);
  });

  it('omnimind://relations/list returns a non-error payload', async () => {
    const result = await (server as any).handleReadResource('omnimind://relations/list');
    const payload = JSON.parse(result.contents[0].text);
    expect(payload.count).toBeDefined();
    expect(Array.isArray(payload.relations)).toBe(true);
  });

  it('unknown resource URI throws', async () => {
    await expect(
      (server as any).handleReadResource('omnimind://unknown/thing'),
    ).rejects.toThrow('Unknown resource');
  });

  it('parseResourceQuery handles URI with no query string', () => {
    const params = (server as any).parseResourceQuery('omnimind://memories/recent');
    expect(params.get('limit')).toBeNull();
  });

  it('parseResourceQuery parses query params', () => {
    const params = (server as any).parseResourceQuery(
      'omnimind://memories/recent?limit=5&namespace=foo',
    );
    expect(params.get('limit')).toBe('5');
    expect(params.get('namespace')).toBe('foo');
  });
});