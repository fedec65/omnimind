/**
 * End-to-end integration tests
 *
 * Tests the full store → search → predict pipeline.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Omnimind } from '../../src/index.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('End-to-End', () => {
  let omni: Omnimind;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omnimind-e2e-'));
    omni = await Omnimind.create({ dataDir: tmpDir });
  });

  afterEach(() => {
    omni.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should store and retrieve a memory', async () => {
    const storeResult = await omni.store('User prefers dark mode', {
      wing: 'preferences',
      room: 'ui',
    });
    expect(storeResult.ok).toBe(true);
    if (!storeResult.ok) return;

    const getResult = await omni.get(storeResult.value.id);
    expect(getResult.ok).toBe(true);
    if (!getResult.ok) return;
    expect(getResult.value).not.toBeNull();
    expect(getResult.value!.content).toBe('User prefers dark mode');
  });

  it('should find stored memories via search', async () => {
    await omni.store('Use GraphQL for the API layer', { wing: 'project-alpha', room: 'architecture' });
    await omni.store('We should use TypeScript strict mode', { wing: 'project-alpha', room: 'dev-rules' });

    const searchResult = await omni.search('GraphQL API');
    expect(searchResult.ok).toBe(true);
    if (!searchResult.ok) return;
    expect(searchResult.value.length).toBeGreaterThan(0);
    expect(searchResult.value[0]!.memory.content).toContain('GraphQL');
  });

  it('should filter search by wing', async () => {
    await omni.store('Alpha decision', { wing: 'alpha' });
    await omni.store('Beta decision', { wing: 'beta' });

    const result = await omni.search('decision', { wing: 'alpha' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBe(1);
    expect(result.value[0]!.memory.wing).toBe('alpha');
  });

  it('should pin and unpin a memory', async () => {
    const stored = await omni.store('Important decision', { wing: 'test' });
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;

    const pinResult = await omni.pin(stored.value.id);
    expect(pinResult.ok).toBe(true);

    const get1 = await omni.get(stored.value.id);
    expect(get1.ok).toBe(true);
    if (!get1.ok || !get1.value) return;
    expect(get1.value.pinned).toBe(true);

    const unpinResult = await omni.unpin(stored.value.id);
    expect(unpinResult.ok).toBe(true);

    const get2 = await omni.get(stored.value.id);
    expect(get2.ok).toBe(true);
    if (!get2.ok || !get2.value) return;
    expect(get2.value.pinned).toBe(false);
  });

  it('should delete a memory', async () => {
    const stored = await omni.store('Delete me', { wing: 'test' });
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;

    const del = await omni.delete(stored.value.id);
    expect(del.ok).toBe(true);

    const get = await omni.get(stored.value.id);
    expect(get.ok).toBe(true);
    if (!get.ok) return;
    expect(get.value).toBeNull();
  });

  it('should return stats', async () => {
    await omni.store('One', { wing: 'a' });
    await omni.store('Two', { wing: 'b' });

    const stats = await omni.stats();
    expect(stats.ok).toBe(true);
    if (!stats.ok) return;
    expect(stats.value.totalMemories).toBe(2);
  });
});
