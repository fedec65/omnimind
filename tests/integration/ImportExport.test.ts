/**
 * Import/Export integration tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Omnimind } from '../../src/index.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('Import/Export', () => {
  let omni: Omnimind;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omnimind-io-test-'));
    omni = await Omnimind.create({ dataDir: tmpDir });
  });

  afterEach(() => {
    omni.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should export and re-import memories via JSON', async () => {
    await omni.store('Memory one', { wing: 'alpha', room: 'r1' });
    await omni.store('Memory two', { wing: 'beta', room: 'r2' });

    const exportResult = omni.exportToJson();
    expect(exportResult.ok).toBe(true);
    if (!exportResult.ok) return;

    const json = exportResult.value;
    expect(json).toContain('omnimind-v1');
    expect(json).toContain('Memory one');

    // Create a fresh instance in a new directory
    const tmpDir2 = mkdtempSync(join(tmpdir(), 'omnimind-io-test2-'));
    const omni2 = await Omnimind.create({ dataDir: tmpDir2 });

    const importResult = await omni2.importFromJson(json);
    expect(importResult.ok).toBe(true);
    if (!importResult.ok) return;

    expect(importResult.value).toBe(2);

    const stats = await omni2.stats();
    expect(stats.ok).toBe(true);
    if (!stats.ok) return;
    expect(stats.value.totalMemories).toBe(2);

    omni2.close();
    rmSync(tmpDir2, { recursive: true, force: true });
  });

  it('should skip duplicates on re-import', async () => {
    await omni.store('Duplicate test', { wing: 'test' });

    const json = omni.exportToJson().value!;
    const importResult = await omni.importFromJson(json);

    expect(importResult.ok).toBe(true);
    if (!importResult.ok) return;
    expect(importResult.value).toBe(0); // All skipped

    const stats = await omni.stats();
    expect(stats.ok).toBe(true);
    if (!stats.ok) return;
    expect(stats.value.totalMemories).toBe(1);
  });

  it('should export readable Markdown', async () => {
    await omni.store('GraphQL is great', { wing: 'tech', room: 'api' });

    const mdResult = omni.exportToMarkdown();
    expect(mdResult.ok).toBe(true);
    if (!mdResult.ok) return;

    expect(mdResult.value).toContain('# Omnimind Memory Export');
    expect(mdResult.value).toContain('GraphQL is great');
    expect(mdResult.value).toContain('[tech] api');
  });
});
