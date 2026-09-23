/**
 * Facade wiring tests: settings-driven construction, suggestions,
 * publishMemoryToShared, 401 handling. Uses an injected fake transport
 * (no network).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Omnimind } from '../../src/index.js';
import { SharedError, type SharedToolTransport } from '../../src/shared/types.js';

class FakeTransport implements SharedToolTransport {
  calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  private queue: Array<() => Promise<unknown>> = [];
  enqueueText(text: string): void {
    this.queue.push(async () => ({ content: [{ type: 'text', text }] }));
  }
  enqueueThrow(error: unknown): void {
    this.queue.push(async () => {
      throw error;
    });
  }
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ name, args });
    const next = this.queue.shift();
    if (!next) throw new Error('FakeTransport: no queued response');
    return next();
  }
  async reset(): Promise<void> {}
  async close(): Promise<void> {}
}

describe('Omnimind facade — shared server wiring', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omnimind-shared-facade-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the shared client when settings are enabled+configured', async () => {
    const omni = await Omnimind.create({ dataDir: tmpDir, adapters: false });
    omni.setSetting('sharedEnabled', 'true');
    omni.setSetting('sharedServerUrl', 'https://example.invalid/mcp');
    omni.setSetting('sharedToken', 'omt_abc');
    await omni.close();

    const omni2 = await Omnimind.create({ dataDir: tmpDir, adapters: false });
    expect(omni2.shared).not.toBeNull();
    expect(omni2.sharedAvailable()).toBe(true);
    await omni2.close();
  });

  it('does not create the shared client when disabled or missing config', async () => {
    const omni = await Omnimind.create({ dataDir: tmpDir, adapters: false });
    expect(omni.shared).toBeNull();
    expect(omni.sharedAvailable()).toBe(false);
    await omni.close();
  });

  it('uses the injected transport regardless of settings', async () => {
    const fake = new FakeTransport();
    fake.enqueueText('{"status":"ok","items":3,"superseded":0}');
    const omni = await Omnimind.create({ dataDir: tmpDir, adapters: false, sharedTransport: fake });
    expect(omni.shared).not.toBeNull();

    const status = await omni.shared!.status();
    expect(status.ok).toBe(true);
    expect(fake.calls[0]!.name).toBe('shared_status');
    await omni.close();
  });

  it('publishMemoryToShared fetches the local memory and publishes its content', async () => {
    const fake = new FakeTransport();
    fake.enqueueText('{"id":"published-1"}');
    const omni = await Omnimind.create({ dataDir: tmpDir, adapters: false, sharedTransport: fake });

    const stored = await omni.store('Concept about testing strategy', { wing: 'eng' });
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;

    // Force the memory to L2 (as the aging pipeline would)
    const updated = await omni.memoryStore.update(stored.value.id, { layer: 2 });
    expect(updated.ok).toBe(true);

    const result = await omni.publishMemoryToShared(stored.value.id, { visibility: 'org' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe('published-1');
    expect(fake.calls[0]!.args).toMatchObject({ level: 2, visibility: 'org', content: 'Concept about testing strategy' });
    await omni.close();
  });

  it('publishMemoryToShared rejects L0 memories', async () => {
    const fake = new FakeTransport();
    const omni = await Omnimind.create({ dataDir: tmpDir, adapters: false, sharedTransport: fake });

    const stored = await omni.store('Fresh verbatim memory', { wing: 'eng' });
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;

    const result = await omni.publishMemoryToShared(stored.value.id, { visibility: 'org' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('L2/L3');
    expect(fake.calls.length).toBe(0);
    await omni.close();
  });

  it('tracks suggestions with cap and TTL', async () => {
    const fake = new FakeTransport();
    const omni = await Omnimind.create({ dataDir: tmpDir, adapters: false, sharedTransport: fake });
    expect(omni.getSharedSuggestions().length).toBe(0);

    const stored = await omni.store('Promoted concept', { wing: 'eng' });
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    const updated = await omni.memoryStore.update(stored.value.id, { layer: 2 });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;

    (omni as any).noteSharedSuggestion(updated.value);
    expect(omni.getSharedSuggestions().length).toBe(1);
    expect(omni.getSharedSuggestions()[0]!.memoryId).toBe(stored.value.id);

    // Cap at 20
    for (let i = 0; i < 25; i++) {
      (omni as any).noteSharedSuggestion({ ...updated.value, id: `m${i}`, layer: 2 });
    }
    expect(omni.getSharedSuggestions().length).toBe(20);

    // TTL: a 25h-old suggestion disappears
    const old = { ...updated.value, id: 'old-one', layer: 2 as const };
    (omni as any).noteSharedSuggestion(old);
    const list = (omni as any).sharedSuggestions as Array<{ memoryId: string; suggestedAt: number }>;
    const entry = list.find((s) => s.memoryId === 'old-one');
    expect(entry).toBeDefined();
    entry!.suggestedAt = Date.now() - 25 * 60 * 60 * 1000;
    expect(omni.getSharedSuggestions().find((s) => s.memoryId === 'old-one')).toBeUndefined();
    await omni.close();
  });

  it('401 via publishMemoryToShared disables shared functionality and records lastSharedError', async () => {
    const fake = new FakeTransport();
    fake.enqueueThrow(new SharedError('unauthorized', 'revoked'));
    fake.enqueueThrow(new SharedError('unauthorized', 'revoked'));
    fake.enqueueThrow(new SharedError('unauthorized', 'revoked'));
    const omni = await Omnimind.create({ dataDir: tmpDir, adapters: false, sharedTransport: fake });

    const stored = await omni.store('Concept', { wing: 'eng' });
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    await omni.memoryStore.update(stored.value.id, { layer: 2 });

    expect(omni.sharedAvailable()).toBe(true);
    const pub = await omni.publishMemoryToShared(stored.value.id, { visibility: 'org' });
    expect(pub.ok).toBe(false);
    expect(omni.sharedAvailable()).toBe(false);

    const last = omni.getSetting('lastSharedError');
    expect(last.ok).toBe(true);
    expect(last.value).toContain('unauthorized');
    await omni.close();
  });

  it('401 via searchShared disables shared functionality and records lastSharedError', async () => {
    const fake = new FakeTransport();
    fake.enqueueThrow(new SharedError('unauthorized', 'revoked'));
    const omni = await Omnimind.create({ dataDir: tmpDir, adapters: false, sharedTransport: fake });

    expect(omni.sharedAvailable()).toBe(true);
    const search = await omni.searchShared('CI pipeline');
    expect(search.ok).toBe(false);
    expect(omni.sharedAvailable()).toBe(false);

    const last = omni.getSetting('lastSharedError');
    expect(last.ok).toBe(true);
    expect(last.value).toContain('unauthorized');
    await omni.close();
  });

  it('401 via statusShared disables shared functionality and records lastSharedError', async () => {
    const fake = new FakeTransport();
    fake.enqueueThrow(new SharedError('unauthorized', 'revoked'));
    const omni = await Omnimind.create({ dataDir: tmpDir, adapters: false, sharedTransport: fake });

    expect(omni.sharedAvailable()).toBe(true);
    const status = await omni.statusShared();
    expect(status.ok).toBe(false);
    expect(omni.sharedAvailable()).toBe(false);

    const last = omni.getSetting('lastSharedError');
    expect(last.ok).toBe(true);
    expect(last.value).toContain('unauthorized');
    await omni.close();
  });

  it('searchShared and statusShared return an error when not configured', async () => {
    const omni = await Omnimind.create({ dataDir: tmpDir, adapters: false });

    const search = await omni.searchShared('anything');
    expect(search.ok).toBe(false);
    if (!search.ok) expect(search.error.message).toContain('not configured');

    const status = await omni.statusShared();
    expect(status.ok).toBe(false);
    if (!status.ok) expect(status.error.message).toContain('not configured');
    await omni.close();
  });

  it('malformed sharedServerUrl at create() degrades to local-only without throwing', async () => {
    const omni = await Omnimind.create({ dataDir: tmpDir, adapters: false });
    omni.setSetting('sharedEnabled', 'true');
    omni.setSetting('sharedServerUrl', 'not a url');
    omni.setSetting('sharedToken', 'omt_abc');
    await omni.close();

    let omni2: Omnimind | null = null;
    await expect(
      (async () => {
        omni2 = await Omnimind.create({ dataDir: tmpDir, adapters: false });
      })(),
    ).resolves.toBeUndefined();
    expect(omni2!.shared).toBeNull();
    expect(omni2!.sharedAvailable()).toBe(false);

    const search = await omni2!.searchShared('anything');
    expect(search.ok).toBe(false);
    await omni2!.close();
  });

  it('persists suggestions and deletes the row on successful publish', async () => {
    const fake = new FakeTransport();
    fake.enqueueText('{"id":"published-1"}');
    const omni = await Omnimind.create({ dataDir: tmpDir, adapters: false, sharedTransport: fake });

    const stored = await omni.store('Promoted concept', { wing: 'eng' });
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    const updated = await omni.memoryStore.update(stored.value.id, { layer: 2 });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;

    (omni as any).noteSharedSuggestion(updated.value);
    const persisted = omni.memoryStore.loadSharedSuggestions();
    expect(persisted.ok).toBe(true);
    if (!persisted.ok) return;
    expect(persisted.value.map((s) => s.memoryId)).toEqual([stored.value.id]);

    const pub = await omni.publishMemoryToShared(stored.value.id, { visibility: 'org' });
    expect(pub.ok).toBe(true);

    expect(omni.getSharedSuggestions()).toEqual([]);
    const after = omni.memoryStore.loadSharedSuggestions();
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value).toEqual([]);
    await omni.close();
  });

  it('boot reloads persisted suggestions and prunes stale ones', async () => {
    const fake = new FakeTransport();
    const omni = await Omnimind.create({ dataDir: tmpDir, adapters: false, sharedTransport: fake });

    const stored = await omni.store('Promoted concept', { wing: 'eng' });
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    const updated = await omni.memoryStore.update(stored.value.id, { layer: 2 });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    (omni as any).noteSharedSuggestion(updated.value);

    // A stale suggestion (25h old) inserted directly into the store
    omni.memoryStore.saveSharedSuggestion({
      memoryId: 'stale-one',
      content: 'Old suggestion',
      level: 2,
      suggestedAt: Date.now() - 25 * 60 * 60 * 1000,
    });
    await omni.close();

    // Reboot against the same data dir: fresh suggestion survives, stale one is pruned
    const omni2 = await Omnimind.create({ dataDir: tmpDir, adapters: false, sharedTransport: new FakeTransport() });
    const suggestions = omni2.getSharedSuggestions();
    expect(suggestions.map((s) => s.memoryId)).toEqual([stored.value.id]);
    expect(suggestions[0]!.content).toBe('Promoted concept');
    await omni2.close();
  });
});
