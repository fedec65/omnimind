/**
 * AgingPipeline unit tests
 * 
 * Tests memory aging logic, compression, and layer transitions.
 */

import { describe, it, expect } from 'vitest';
import { AgingPipeline } from '../../src/layers/AgingPipeline.js';
import { MemoryLayer, TimeConstants } from '../../src/core/types.js';
import type { Memory } from '../../src/core/types.js';

function createMemory(overrides: Partial<Memory> = {}): Memory {
  const now = Date.now();
  return {
    id: 'test-id',
    content: 'This is a test memory about GraphQL API architecture decisions that were made on Tuesday.',
    contentHash: 'abc123',
    embedding: new Float32Array(384),
    layer: MemoryLayer.Verbatim,
    wing: 'test',
    room: 'default',
    sourceTool: 'test',
    sourceId: null,
    confidence: 1.0,
    createdAt: now - TimeConstants.WEEK * 2, // 2 weeks old
    accessedAt: now,
    accessCount: 5,
    validFrom: null,
    validTo: null,
    pinned: false,
    compressedRef: null,
    conceptRefs: [],
    ...overrides,
  };
}

describe('AgingPipeline', () => {
  const pipeline = new AgingPipeline();

  describe('shouldAge', () => {
    it('should return true for old verbatim memories', () => {
      const memory = createMemory({
        layer: MemoryLayer.Verbatim,
        createdAt: Date.now() - TimeConstants.WEEK * 2,
      });
      expect(pipeline.shouldAge(memory)).toBe(true);
    });

    it('should return false for fresh verbatim memories', () => {
      const memory = createMemory({
        layer: MemoryLayer.Verbatim,
        createdAt: Date.now() - TimeConstants.DAY,
      });
      expect(pipeline.shouldAge(memory)).toBe(false);
    });

    it('should return false for pinned memories', () => {
      const memory = createMemory({
        pinned: true,
        createdAt: Date.now() - TimeConstants.YEAR,
      });
      expect(pipeline.shouldAge(memory)).toBe(false);
    });

    it('should return false for wisdom layer', () => {
      const memory = createMemory({
        layer: MemoryLayer.Wisdom,
        createdAt: Date.now() - TimeConstants.YEAR,
      });
      expect(pipeline.shouldAge(memory)).toBe(false);
    });
  });

  describe('getTargetLayer', () => {
    it('should target compressed for 2-week-old memory', () => {
      const memory = createMemory({
        layer: MemoryLayer.Verbatim,
        createdAt: Date.now() - TimeConstants.WEEK * 2,
      });
      expect(pipeline.getTargetLayer(memory)).toBe(MemoryLayer.Compressed);
    });

    it('should target concept for 2-month-old memory', () => {
      const memory = createMemory({
        layer: MemoryLayer.Compressed,
        createdAt: Date.now() - TimeConstants.MONTH * 2,
      });
      expect(pipeline.getTargetLayer(memory)).toBe(MemoryLayer.Concept);
    });

    it('should target wisdom for 6-month-old memory', () => {
      const memory = createMemory({
        layer: MemoryLayer.Concept,
        createdAt: Date.now() - TimeConstants.HALF_YEAR,
      });
      expect(pipeline.getTargetLayer(memory)).toBe(MemoryLayer.Wisdom);
    });

    it('should stay verbatim for fresh memory', () => {
      const memory = createMemory({
        layer: MemoryLayer.Verbatim,
        createdAt: Date.now() - TimeConstants.DAY,
      });
      expect(pipeline.getTargetLayer(memory)).toBe(MemoryLayer.Verbatim);
    });
  });

  describe('compressToL1', () => {
    it('should compress text using rules', async () => {
      const memory = createMemory({
        content: 'We decided to use GraphQL because it is better than REST. However, we need to handle caching carefully.',
        layer: MemoryLayer.Verbatim,
      });

      const result = await pipeline.transition(memory, MemoryLayer.Compressed);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.layer).toBe(MemoryLayer.Compressed);
      expect(result.value.content.length).toBeLessThan(memory.content.length);
      expect(result.value.compressedRef).toBe(memory.id);
    });

    it('should replace common connectors with symbols', async () => {
      const memory = createMemory({
        content: 'This is good because it works. Therefore we should use it.',
        layer: MemoryLayer.Verbatim,
      });

      const result = await pipeline.transition(memory, MemoryLayer.Compressed);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Symbols should be present or text should be shorter
      const hasSymbols = ['∵', '∴', '~'].some(s => result.value.content.includes(s));
      const isShorter = result.value.content.length < memory.content.length;
      expect(hasSymbols || isShorter).toBe(true);
    });
  });

  describe('extractToL2', () => {
    it('should extract concepts to graph nodes', async () => {
      const memory = createMemory({
        content: 'UserService uses GraphQL to fetch data from PostgreSQL database.',
        layer: MemoryLayer.Compressed,
      });

      const result = await pipeline.transition(memory, MemoryLayer.Concept);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.layer).toBe(MemoryLayer.Concept);
      expect(result.value.content).toContain('[Concept:');
      expect(result.value.conceptRefs.length).toBeGreaterThan(0);
    });
  });

  describe('distillToL3', () => {
    it('should distill patterns to wisdom', async () => {
      const memory = createMemory({
        content: 'We should always prefer TypeScript over JavaScript because it catches errors early.',
        layer: MemoryLayer.Concept,
      });

      const result = await pipeline.transition(memory, MemoryLayer.Wisdom);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.layer).toBe(MemoryLayer.Wisdom);
      expect(result.value.content).toContain('[Wisdom:');
    });
  });

  describe('compressionStats', () => {
    it('should report compression ratio', async () => {
      const memory = createMemory({
        content: 'This is a somewhat long test memory with many words that should be compressible because it contains redundant information and filler words.',
        layer: MemoryLayer.Verbatim,
      });

      const result = await pipeline.transition(memory, MemoryLayer.Compressed);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const stats = pipeline.getCompressionStats(memory, result.value);
      expect(stats.reduction).toBeGreaterThan(0);
      expect(stats.ratio).toBeLessThan(1);
    });
  });
});
