/**
 * Aging content-hash collision regression test
 *
 * L0→L1 compression truncates long memories to their first ~500 chars.
 * Two memories that share a long common prefix therefore compress to
 * byte-identical content. Databases created by older app versions carry a
 * leftover UNIQUE index on (content_hash, namespace) — the current schema
 * dedups at the application level instead — so on those databases the
 * second memory's aged-content update collides. checkAging must still
 * advance the colliding memory's layer (keeping its original content)
 * instead of leaving it stuck at L0 forever.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { Omnimind } from '../../src/index.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('Aging content-hash collision', () => {
  let omni: Omnimind;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omnimind-aging-collision-'));
    omni = await Omnimind.create({ dataDir: tmpDir, adapters: false });
  });

  afterEach(async () => {
    await omni.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('advances the layer even when the aged content collides with another memory', async () => {
    // Two long memories with an identical >500-char prefix: L1 truncation
    // keeps only the first 500 chars, so both compress to the same string.
    const prefix = 'alpha beta gamma delta '.repeat(60); // ~1380 chars
    const content1 = `${prefix} UNIQUE-TAIL-ONE`;
    const content2 = `${prefix} UNIQUE-TAIL-TWO`;

    const store1 = await omni.store(content1, { wing: 'collision-test' });
    const store2 = await omni.store(content2, { wing: 'collision-test' });
    expect(store1.ok).toBe(true);
    expect(store2.ok).toBe(true);
    if (!store1.ok || !store2.ok) return;

    // Backdate both to 8 days old → shouldAge targets L1 (Compressed).
    // Also recreate the legacy UNIQUE index that older app versions left
    // on real-world databases — that is what makes the second update collide.
    const db = new Database(join(tmpDir, 'memory.db'));
    db.prepare('CREATE UNIQUE INDEX idx_memories_hash_ns ON memories(content_hash, namespace)').run();
    db.prepare('UPDATE memories SET created_at = ?').run(Date.now() - 8 * 86400000);
    db.close();

    const age1 = await omni.checkAging(store1.value.id);
    const age2 = await omni.checkAging(store2.value.id);
    expect(age1.ok).toBe(true);
    expect(age2.ok).toBe(true);

    const get1 = await omni.get(store1.value.id);
    const get2 = await omni.get(store2.value.id);
    expect(get1.ok).toBe(true);
    expect(get2.ok).toBe(true);
    if (!get1.ok || !get1.value || !get2.ok || !get2.value) return;

    // Both memories must reach L1 — before the fix, the second stayed at L0
    // because its content update violated UNIQUE (content_hash, namespace).
    expect(get1.value.layer).toBe(1);
    expect(get2.value.layer).toBe(1);

    // The first keeps the truncated compressed form; the second (colliding)
    // keeps its original full content — no data loss.
    expect(get1.value.content.endsWith('[...]')).toBe(true);
    expect(get2.value.content).toBe(content2);
  });
});
