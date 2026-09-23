/**
 * Unit tests for McpSharedClient against an injected fake transport.
 * No network, no vi.mock — the transport is the seam.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { McpSharedClient, McpToolTransport } from '../../src/shared/McpSharedClient.js';
import {
  SharedError,
  type SharedToolTransport,
  type SharedClientConfig,
} from '../../src/shared/types.js';

class FakeTransport implements SharedToolTransport {
  calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  resets = 0;
  private queue: Array<() => Promise<unknown>> = [];

  enqueueText(text: string): void {
    this.queue.push(async () => ({ content: [{ type: 'text', text }] }));
  }

  enqueueRaw(raw: unknown): void {
    this.queue.push(async () => raw);
  }

  enqueueThrow(error: unknown): void {
    this.queue.push(async () => {
      throw error;
    });
  }

  enqueueToolError(text: string): void {
    this.queue.push(async () => ({ content: [{ type: 'text', text }], isError: true }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ name, args });
    const next = this.queue.shift();
    if (!next) throw new Error('FakeTransport: no queued response');
    return next();
  }

  async reset(): Promise<void> {
    this.resets++;
  }

  async close(): Promise<void> {}
}

const CONFIG: SharedClientConfig = {
  serverUrl: 'https://example.invalid/mcp',
  token: 'omt_testtoken',
  retryDelayMs: 1,
};

function searchPayload(): string {
  return JSON.stringify([
    {
      item: {
        id: 'item-1',
        content: 'Shared decision: use Postgres',
        level: 2,
        visibility: 'org',
        metadata: { source: 'doc' },
        trustWeight: 0.8,
        createdAt: 1720000000000,
        supersededAt: null,
      },
      score: 0.91,
      matchType: 'hybrid',
    },
  ]);
}

describe('McpSharedClient', () => {
  let transport: FakeTransport;
  let client: McpSharedClient;

  beforeEach(() => {
    transport = new FakeTransport();
    client = new McpSharedClient(CONFIG, transport);
  });

  it('search sends shared_search with query_text and parses results', async () => {
    transport.enqueueText(searchPayload());

    const result = await client.search('postgres decision', 5);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBe(1);
    expect(result.value[0]!.item.id).toBe('item-1');
    expect(result.value[0]!.item.visibility).toBe('org');
    expect(result.value[0]!.score).toBe(0.91);
    expect(transport.calls[0]!.name).toBe('shared_search');
    expect(transport.calls[0]!.args).toEqual({ query_text: 'postgres decision', limit: 5 });
  });

  it('search omits limit when not given', async () => {
    transport.enqueueText('[]');

    const result = await client.search('anything');

    expect(result.ok).toBe(true);
    expect(transport.calls[0]!.args).toEqual({ query_text: 'anything' });
  });

  it('search skips malformed entries but keeps valid ones', async () => {
    transport.enqueueText(
      JSON.stringify([
        { item: { content: 'no id here' }, score: 0.5 },
        {
          item: { id: 'ok', content: 'valid', level: 3, visibility: 'team', trustWeight: 0.5, createdAt: 1, supersededAt: null },
          score: 0.7,
        },
      ]),
    );

    const result = await client.search('q');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBe(1);
    expect(result.value[0]!.item.id).toBe('ok');
  });

  it('search excludes superseded entries (non-null supersededAt)', async () => {
    transport.enqueueText(
      JSON.stringify([
        {
          item: {
            id: 'active-1',
            content: 'Still valid shared memory',
            level: 2,
            visibility: 'org',
            metadata: {},
            trustWeight: 0.8,
            createdAt: 1720000000000,
            supersededAt: null,
          },
          score: 0.9,
        },
        {
          item: {
            id: 'old-1',
            content: 'Superseded shared memory',
            level: 2,
            visibility: 'org',
            metadata: {},
            trustWeight: 0.5,
            createdAt: 1710000000000,
            supersededAt: 1720000000000,
          },
          score: 0.8,
        },
      ]),
    );

    const result = await client.search('q');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBe(1);
    expect(result.value[0]!.item.id).toBe('active-1');
  });

  it('search maps non-array payload to malformed error', async () => {
    transport.enqueueText('{"unexpected": true}');

    const result = await client.search('q');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('malformed');
  });

  it('publish sends shared_publish with mapped args and returns id', async () => {
    transport.enqueueText(JSON.stringify({ id: 'uuid-123' }));

    const result = await client.publish({
      level: 2,
      visibility: 'team',
      content: 'concept text',
      trustWeight: 0.7,
      workspaceId: 'ws-1',
      metadata: { origin: 'local' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe('uuid-123');
    expect(transport.calls[0]!.name).toBe('shared_publish');
    expect(transport.calls[0]!.args).toEqual({
      level: 2,
      visibility: 'team',
      content: 'concept text',
      trust_weight: 0.7,
      workspace_id: 'ws-1',
      metadata: { origin: 'local' },
    });
  });

  it('publish without optional args sends only required fields', async () => {
    transport.enqueueText(JSON.stringify({ id: 'uuid-9' }));

    await client.publish({ level: 3, visibility: 'org', content: 'wisdom' });

    expect(transport.calls[0]!.args).toEqual({ level: 3, visibility: 'org', content: 'wisdom' });
  });

  it('status parses items and superseded', async () => {
    transport.enqueueText(JSON.stringify({ status: 'ok', items: 42, superseded: 7 }));

    const result = await client.status();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ items: 42, superseded: 7 });
    expect(transport.calls[0]!.name).toBe('shared_status');
  });

  it('retries on rate_limit (429) then succeeds', async () => {
    transport.enqueueThrow(new SharedError('rate_limited', '429'));
    transport.enqueueText(searchPayload());

    const result = await client.search('q');

    expect(result.ok).toBe(true);
    expect(transport.calls.length).toBe(2);
    expect(transport.resets).toBe(1);
  });

  it('retries on 5xx then gives up after maxRetries', async () => {
    transport.enqueueThrow(new SharedError('server', '500'));
    transport.enqueueThrow(new SharedError('server', '502'));
    transport.enqueueThrow(new SharedError('server', '503'));

    const result = await client.search('q');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('server');
    expect(transport.calls.length).toBe(3); // 1 + 2 retries
    expect(transport.resets).toBe(2);
  });

  it('does NOT retry on unauthorized (401)', async () => {
    transport.enqueueThrow(new SharedError('unauthorized', 'token revoked'));

    const result = await client.search('q');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unauthorized');
    expect(transport.calls.length).toBe(1);
    expect(transport.resets).toBe(0);
  });

  it('classifies raw thrown errors by code/message', async () => {
    transport.enqueueThrow(Object.assign(new Error('HTTP 401'), { code: 401 }));

    const result = await client.status();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unauthorized');
  });

  it('maps isError tool results to server error and retries', async () => {
    transport.enqueueToolError('internal boom');
    transport.enqueueToolError('internal boom');
    transport.enqueueToolError('internal boom');

    const result = await client.status();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('server');
    expect(transport.calls.length).toBe(3);
  });

  it('maps invalid JSON to malformed error without retry', async () => {
    transport.enqueueText('not json{');

    const result = await client.status();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('malformed');
    expect(transport.calls.length).toBe(1);
  });

  it('maps missing text content to malformed error', async () => {
    transport.enqueueRaw({ content: [] });

    const result = await client.status();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('malformed');
  });

  it('times out a hanging call as network error', async () => {
    const slow: SharedToolTransport = {
      async callTool() {
        await new Promise((r) => setTimeout(r, 200));
        return { content: [{ type: 'text', text: '[]' }] };
      },
      async reset() {},
      async close() {},
    };
    const impatient = new McpSharedClient({ ...CONFIG, timeoutMs: 20, retryDelayMs: 1, maxRetries: 0 }, slow);

    const result = await impatient.search('q');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('network');
  });

  it('publish does NOT retry on network failure (ambiguous, no idempotency key)', async () => {
    transport.enqueueThrow(new SharedError('network', 'socket hangup'));

    const result = await client.publish({ level: 2, visibility: 'org', content: 'concept' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('network');
    expect(transport.calls.length).toBe(1);
    expect(transport.resets).toBe(0);
  });

  it('publish does NOT retry on server (5xx) failures', async () => {
    transport.enqueueThrow(new SharedError('server', '500'));

    const result = await client.publish({ level: 2, visibility: 'org', content: 'concept' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('server');
    expect(transport.calls.length).toBe(1);
    expect(transport.resets).toBe(0);
  });

  it('publish does NOT retry on isError tool results', async () => {
    transport.enqueueToolError('internal boom');

    const result = await client.publish({ level: 2, visibility: 'org', content: 'concept' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('server');
    expect(transport.calls.length).toBe(1);
    expect(transport.resets).toBe(0);
  });

  it('publish does NOT retry on per-call timeout', async () => {
    let calls = 0;
    const slow: SharedToolTransport = {
      async callTool() {
        calls++;
        await new Promise((r) => setTimeout(r, 200));
        return { content: [{ type: 'text', text: '{"id":"late"}' }] };
      },
      async reset() {},
      async close() {},
    };
    const impatient = new McpSharedClient({ ...CONFIG, timeoutMs: 20, retryDelayMs: 1 }, slow);

    const result = await impatient.publish({ level: 2, visibility: 'org', content: 'concept' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('network');
    expect(calls).toBe(1);
  });

  it('publish retries on 429 (rate_limited) then succeeds', async () => {
    transport.enqueueThrow(new SharedError('rate_limited', '429'));
    transport.enqueueText(JSON.stringify({ id: 'uuid-after-429' }));

    const result = await client.publish({ level: 2, visibility: 'org', content: 'concept' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe('uuid-after-429');
    expect(transport.calls.length).toBe(2);
    expect(transport.resets).toBe(1);
  });
});

describe('McpToolTransport — single in-flight connection', () => {
  function makeConnector(delayMs = 30): {
    state: { connects: number; closes: number };
    connector: () => Promise<{
      callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
      close: () => Promise<void>;
    }>;
  } {
    const state: { connects: number; closes: number } = { connects: 0, closes: 0 };
    const connector = async () => {
      state.connects++;
      await new Promise((r) => setTimeout(r, delayMs));
      return {
        callTool: async () => ({ content: [{ type: 'text', text: searchPayload() }] }),
        close: async () => {
          state.closes++;
        },
      };
    };
    return { state, connector };
  }

  it('two concurrent searches trigger exactly one connect()', async () => {
    const { state, connector } = makeConnector(30);
    const transport = new McpToolTransport('https://example.invalid/mcp', 'tok', connector);
    const client = new McpSharedClient(CONFIG, transport);

    const [r1, r2] = await Promise.all([client.search('first'), client.search('second')]);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(state.connects).toBe(1);
    await client.close();
  });

  it('reset() during a slow connect drops the late connection instead of adopting it', async () => {
    const { state, connector } = makeConnector(40);
    const transport = new McpToolTransport('https://example.invalid/mcp', 'tok', connector);
    const client = new McpSharedClient(CONFIG, transport);

    const pending = client.search('first');
    await new Promise((r) => setTimeout(r, 5));
    await transport.reset();
    const first = await pending;

    // The first attempt fails (reset superseded its connect); the read path
    // retries and establishes a fresh connection — the late one is closed,
    // never adopted.
    expect(first.ok).toBe(true);
    expect(state.connects).toBe(2);
    expect(state.closes).toBe(1);

    const second = await client.search('second');
    expect(second.ok).toBe(true);
    expect(state.connects).toBe(2); // reuses the fresh connection
    await client.close();
  });
});
