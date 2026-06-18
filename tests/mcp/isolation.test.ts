/**
 * Multi-agent memory isolation e2e test.
 *
 * The MCP server's per-client `clientNamespace` field is what isolates
 * writes/reads between connected clients. The underlying MemoryStore
 * already supports namespace filtering (proved by
 * tests/core/MemoryStore.namespace.test.ts); here we verify that the
 * MCP layer routes writes/reads through the auto-derived namespace.
 *
 * To test the MCP-layer logic in isolation from the SQLite layer, we
 * share a single MemoryStore across two OmnimindMcpServer instances
 * and only vary their `clientNamespace`. If the MCP layer correctly
 * threads the namespace, the storage layer's namespace column does
 * the rest.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import { OmnimindMcpServer } from '../../src/mcp/server.js';
import { MemoryStore } from '../../src/core/MemoryStore.js';

describe('MCP server — multi-agent namespace isolation', () => {
  let tmpDir: string;
  let sharedStore: MemoryStore;
  let serverA: OmnimindMcpServer;
  let serverB: OmnimindMcpServer;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omnimind-mcp-iso-'));

    sharedStore = new MemoryStore({ dbPath: join(tmpDir, 'shared.db') });
    await sharedStore.init();

    serverA = new OmnimindMcpServer();
    serverB = new OmnimindMcpServer();

    // Share the same underlying store across both server instances.
    // Vary only the per-instance clientNamespace — that's the variable
    // under test.
    (serverA as any).store = sharedStore;
    (serverB as any).store = sharedStore;
    (serverA as any).clientNamespace = 'ag-claudecode1234';
    (serverB as any).clientNamespace = 'ag-cursorabcdef';
  });

  afterEach(async () => {
    sharedStore.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("client A's memories are invisible to client B via omnimind_search", async () => {
    const handlerA = (serverA as any).handleStore.bind(serverA);
    const handlerB = (serverB as any).handleStore.bind(serverB);
    const searchA = (serverA as any).handleSearch.bind(serverA);
    const searchB = (serverB as any).handleSearch.bind(serverB);

    await handlerA({ content: 'Claude secret decision', wing: 'test' });
    await handlerB({ content: 'Cursor secret decision', wing: 'test' });

    const aResult = await searchA({ query: 'secret' });
    const bResult = await searchB({ query: 'secret' });

    expect(aResult.content[0].text).toContain('Claude secret');
    expect(aResult.content[0].text).not.toContain('Cursor secret');

    expect(bResult.content[0].text).toContain('Cursor secret');
    expect(bResult.content[0].text).not.toContain('Claude secret');
  });

  it('explicit namespace parameter on omnimind_search overrides auto-derived namespace', async () => {
    const handlerA = (serverA as any).handleStore.bind(serverA);
    const handlerB = (serverB as any).handleStore.bind(serverB);
    const searchA = (serverA as any).handleSearch.bind(serverA);

    await handlerA({ content: 'Claude-only note', wing: 'test' });
    await handlerB({ content: 'Cursor-only note', wing: 'test' });

    // A asks specifically for B's namespace — should now see the cursor memory
    const cross = await searchA({ query: 'note', namespace: 'ag-cursorabcdef' });
    expect(cross.content[0].text).toContain('Cursor-only note');
    expect(cross.content[0].text).not.toContain('Claude-only note');
  });

  it('explicit namespace on omnimind_store overrides auto-derived namespace', async () => {
    const handlerA = (serverA as any).handleStore.bind(serverA);
    const searchA = (serverA as any).handleSearch.bind(serverA);
    const searchB = (serverB as any).handleSearch.bind(serverB);

    // Client A writes into B's namespace
    await handlerA({
      content: 'A wrote into B namespace',
      wing: 'test',
      namespace: 'ag-cursorabcdef',
    });

    // Client B can now see it via its own (B) namespace
    const bResult = await searchB({ query: 'wrote' });
    expect(bResult.content[0].text).toContain('A wrote into B');

    // Client A (its own namespace) does NOT see it
    const aResult = await searchA({ query: 'wrote' });
    expect(aResult.content[0].text).not.toContain('A wrote into B');
  });

  it('omnimind_status surfaces the auto-derived client namespace', async () => {
    const statusA = (serverA as any).handleStatus.bind(serverA);
    const statusB = (serverB as any).handleStatus.bind(serverB);

    const aStatus = await statusA();
    const bStatus = await statusB();

    expect(aStatus.content[0].text).toContain('Namespace: ag-claudecode1234');
    expect(bStatus.content[0].text).toContain('Namespace: ag-cursorabcdef');
  });

  it('default client (no namespace bound) sees cross-namespace results', async () => {
    const serverC = new OmnimindMcpServer();
    (serverC as any).store = sharedStore;
    // clientNamespace stays at its default 'default'

    const handlerA = (serverA as any).handleStore.bind(serverA);
    const handlerC = (serverC as any).handleStore.bind(serverC);
    const searchC = (serverC as any).handleSearch.bind(serverC);

    // A writes to its own namespace
    await handlerA({ content: 'A private memory', wing: 'test' });
    // C writes to default
    await handlerC({ content: 'C public memory', wing: 'test' });

    // C's search should NOT include A's private memory because
    // effectiveNamespace = input.namespace ?? (this.clientNamespace !== 'default' ? ... : undefined)
    // and C's clientNamespace IS 'default', so searchOpts.namespace = undefined
    // → no filter applied → all rows returned.
    // Verify that C sees both (default-client behavior preserved).
    const cResult = await searchC({ query: 'memory' });
    expect(cResult.content[0].text).toContain('C public memory');
    expect(cResult.content[0].text).toContain('A private memory');
  });

  it('homedir-based dbPath construction does not throw when HOME is set', () => {
    // Sanity check: the default constructor path produces a server
    // (catches regressions in the import block we modified).
    expect(() => new OmnimindMcpServer()).not.toThrow();
    expect(join(homedir(), '.omnimind', 'memory.db')).toContain('.omnimind');
  });
});