/**
 * Tests for the three shared-server MCP tools. Follows the isolation.test.ts
 * pattern: construct the server without init() and inject the facade bits.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ok } from '../../src/core/types.js';
import { OmnimindMcpServer } from '../../src/mcp/server.js';
import type { SharedSearchResult } from '../../src/shared/types.js';

const NOT_CONFIGURED = 'Shared memory server not configured';

function makeServer(overrides: Record<string, unknown> = {}): OmnimindMcpServer {
  const server = new OmnimindMcpServer();
  const searchResults: SharedSearchResult[] = [
    {
      item: {
        id: 'x1',
        content: 'Org memory about CI',
        level: 2,
        visibility: 'org',
        metadata: {},
        trustWeight: 0.7,
        createdAt: 1,
        supersededAt: null,
      },
      score: 0.83,
      matchType: 'hybrid',
    },
  ];
  (server as any).omni = {
    sharedAvailable: () => true,
    searchShared: async () => ok(searchResults),
    statusShared: async () => ok({ items: 12, superseded: 3 }),
    publishMemoryToShared: async () => ok('new-uuid'),
    ...overrides,
  };
  return server;
}

describe('MCP shared tools', () => {
  let server: OmnimindMcpServer;

  beforeEach(() => {
    server = makeServer();
  });

  it('omnimind_shared_search returns formatted results', async () => {
    const handler = (server as any).handleSharedSearch.bind(server);
    const result = await handler({ query: 'CI pipeline' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Found 1 shared memories');
    expect(result.content[0].text).toContain('Org memory about CI');
  });

  it('omnimind_shared_search reports not-configured without error', async () => {
    server = makeServer({ sharedAvailable: () => false });
    const handler = (server as any).handleSharedSearch.bind(server);
    const result = await handler({ query: 'CI' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain(NOT_CONFIGURED);
  });

  it('omnimind_shared_publish delegates to publishMemoryToShared', async () => {
    let received: unknown = null;
    server = makeServer({
      publishMemoryToShared: async (id: string, opts: unknown) => {
        received = { id, opts };
        return ok('new-uuid');
      },
    });
    const handler = (server as any).handleSharedPublish.bind(server);
    const result = await handler({ memory_id: 'mem-1', visibility: 'team', workspace_id: 'ws-9', trust_weight: 0.7 });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('new-uuid');
    expect(received).toEqual({
      id: 'mem-1',
      opts: { visibility: 'team', workspaceId: 'ws-9', trustWeight: 0.7 },
    });
  });

  it('omnimind_shared_publish requires workspace_id for team visibility', async () => {
    const handler = (server as any).handleSharedPublish.bind(server);
    const result = await handler({ memory_id: 'mem-1', visibility: 'team' });

    expect(result.isError).toBe(true);
  });

  it('omnimind_shared_status reports stats', async () => {
    const handler = (server as any).handleSharedStatus.bind(server);
    const result = await handler();

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('12 items');
  });

  it('omnimind_shared_status reports not-configured', async () => {
    server = makeServer({ sharedAvailable: () => false });
    const handler = (server as any).handleSharedStatus.bind(server);
    const result = await handler();

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain(NOT_CONFIGURED);
  });
});
