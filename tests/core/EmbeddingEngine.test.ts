/**
 * EmbeddingEngine unit tests
 * 
 * Tests model loading, embedding generation, and vector properties.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { EmbeddingEngine } from '../../src/core/EmbeddingEngine.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, rmSync, existsSync } from 'fs';

describe('EmbeddingEngine', () => {
  let engine: EmbeddingEngine;
  let tmpDir: string;
  let skipTests = false;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omnimind-embed-test-'));
    engine = new EmbeddingEngine({ cacheDir: tmpDir });

    const result = await engine.init();
    if (!result.ok) {
      console.log('Skipping EmbeddingEngine tests — model not available:', result.error.message);
      skipTests = true;
      return;
    }
  }, 120000); // 2 minute timeout for model download

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should generate embeddings of correct dimension', async () => {
    if (skipTests) return;
    const result = await engine.embed('Hello world');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.length).toBe(384); // all-MiniLM-L6-v2 dimensions
  });

  it('should return normalized vectors', async () => {
    if (skipTests) return;
    const result = await engine.embed('Test text');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // L2 norm should be ~1.0
    let sum = 0;
    for (let i = 0; i < result.value.length; i++) {
      sum += result.value[i] * result.value[i];
    }
    const norm = Math.sqrt(sum);
    expect(norm).toBeCloseTo(1.0, 1);
  });

  it('should handle empty string', async () => {
    if (skipTests) return;
    const result = await engine.embed('');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.length).toBe(384);
  });

  it('should generate different embeddings for different texts', async () => {
    if (skipTests) return;
    const r1 = await engine.embed('Hello world');
    const r2 = await engine.embed('Goodbye world');

    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;

    // Should be different vectors
    let same = true;
    for (let i = 0; i < r1.value.length; i++) {
      if (Math.abs(r1.value[i] - r2.value[i]) > 0.001) {
        same = false;
        break;
      }
    }
    expect(same).toBe(false);
  });

  it('should generate similar embeddings for similar texts', async () => {
    if (skipTests) return;
    const r1 = await engine.embed('The cat sat on the mat');
    const r2 = await engine.embed('A cat was sitting on a mat');

    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;

    // Cosine similarity should be high (> 0.8)
    let dot = 0;
    for (let i = 0; i < r1.value.length; i++) {
      dot += r1.value[i] * r2.value[i];
    }
    expect(dot).toBeGreaterThan(0.8);
  });
});
