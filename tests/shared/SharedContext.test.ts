/**
 * Tests for the <omnimind_shared> context block: formatting, superseded
 * filtering, suggestions, cache TTL, silent omission on errors.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Omnimind } from '../../src/index.js';
import { SharedError, type SharedToolTransport } from '../../src/shared/types.js';

class FakeTransport implements SharedToolTransport {
  calls = 0;
  failNext = 0;
  private queue: Array<() => Promise<unknown>> = [];
  enqueueText(text: string): void {
    this.queue.push(async () => ({ content: [{ type: 'text', text }] }));
  }
  async callTool(): Promise<unknown> {
    this.calls++;
    if (this.failNext > 0) {
      this.failNext--;
      throw new SharedError('network', 'down');
    }
    const next = this.queue.shift();
    if (!next) throw new Error('FakeTransport: no queued response');
    return next();
  }
  async reset(): Promise<void> {}
  async close(): Promise<void> {}
}

const RESULT = (id: string, content: string, supersededAt: number | null = null) => ({
  item: {
    id,
    content,
    level: 2,
    visibility: 'org',
    metadata: {},
    trustWeight: 0.5,
    createdAt: 1,
    supersededAt,
  },
  score: 0.9,
  matchType: 'hybrid',
});

describe('getContextInjection — omnimind_shared block', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omnimind-shared-ctx-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('appends <omnimind_shared> with results, filtering superseded items', async () => {
    const fake = new FakeTransport();
    fake.enqueueText(JSON.stringify([RESULT('a', 'Active shared memory'), RESULT('b', 'Superseded one', 1720000000000)]));
    const omni = await Omnimind.create({ dataDir: tmpDir, adapters: false, sharedTransport: fake });

    const injection = await omni.getContextInjection();
    expect(injection.ok).toBe(true);
    if (!injection.ok) return;
    expect(injection.value).toContain('<omnimind_shared');
    expect(injection.value).toContain('Active shared memory');
    expect(injection.value).not.toContain('Superseded one');
    await omni.close();
  });

  it('omits the block silently when the shared server errors', async () => {
    const fake = new FakeTransport();
    fake.failNext = 3; // exhaust retries
    const omni = await Omnimind.create({ dataDir: tmpDir, adapters: false, sharedTransport: fake });

    const injection = await omni.getContextInjection();
    expect(injection.ok).toBe(true);
    if (!injection.ok) return;
    expect(injection.value).not.toContain('<omnimind_shared');
    await omni.close();
  });

  it('omits the block when no shared client is configured', async () => {
    const omni = await Omnimind.create({ dataDir: tmpDir, adapters: false });

    const injection = await omni.getContextInjection();
    expect(injection.ok).toBe(true);
    if (!injection.ok) return;
    expect(injection.value).not.toContain('<omnimind_shared');
    await omni.close();
  });

  it('includes pending suggestions as shared_suggestion lines', async () => {
    const fake = new FakeTransport();
    const omni = await Omnimind.create({ dataDir: tmpDir, adapters: false, sharedTransport: fake });

    const stored = await omni.store('Freshly promoted concept worth sharing', { wing: 'eng' });
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    const updated = await omni.memoryStore.update(stored.value.id, { layer: 2 });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    (omni as any).noteSharedSuggestion(updated.value);

    const injection = await omni.getContextInjection();
    expect(injection.ok).toBe(true);
    if (!injection.ok) return;
    expect(injection.value).toContain('shared_suggestion');
    expect(injection.value).toContain('Freshly promoted concept worth sharing');
    await omni.close();
  });

  it('caches results for 60s per fingerprint', async () => {
    const fake = new FakeTransport();
    fake.enqueueText(JSON.stringify([RESULT('a', 'Cached shared memory')]));
    const omni = await Omnimind.create({ dataDir: tmpDir, adapters: false, sharedTransport: fake });

    const first = await omni.getContextInjection();
    expect(first.ok).toBe(true);
    const callsAfterFirst = fake.calls;

    const second = await omni.getContextInjection();
    expect(second.ok).toBe(true);
    expect(fake.calls).toBe(callsAfterFirst); // served from cache

    // Expire the cache artificially
    (omni as any).sharedCache = null;
    fake.enqueueText(JSON.stringify([RESULT('c', 'Fresh after expiry')]));
    const third = await omni.getContextInjection();
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.value).toContain('Fresh after expiry');
    await omni.close();
  });
});
