/**
 * ContextInjector unit tests
 *
 * Tests prediction formatting, token budget enforcement, and MCP resource generation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ContextInjector } from '../../src/prediction/ContextInjector.js';
import { IntentPredictor } from '../../src/prediction/IntentPredictor.js';
import { buildFingerprint } from '../../src/prediction/IntentPredictor.js';
import { MemoryLayer } from '../../src/core/types.js';
import type { Memory } from '../../src/core/types.js';

function makeMemory(id: string, content: string, wing = 'test', room = 'default'): Memory {
  return {
    id,
    content,
    contentHash: `hash-${id}`,
    embedding: new Float32Array(384),
    layer: MemoryLayer.Verbatim,
    wing,
    room,
    sourceTool: 'test',
    sourceId: null,
    confidence: 1,
    createdAt: Date.now(),
    accessedAt: Date.now(),
    accessCount: 1,
    validFrom: null,
    validTo: null,
    pinned: false,
    compressedRef: null,
    conceptRefs: [],
  };
}

describe('ContextInjector', () => {
  let predictor: IntentPredictor;
  let injector: ContextInjector;
  const memories = new Map<string, Memory>();

  beforeEach(() => {
    predictor = new IntentPredictor({ confidenceThreshold: 0.1, maxPredictions: 3 });
    memories.clear();

    injector = new ContextInjector(
      predictor,
      async (id) => memories.get(id) ?? null,
      { tokenBudget: 150, minConfidence: 0.1 },
    );
  });

  describe('inject', () => {
    it('should return empty when no predictions exist', async () => {
      const fp = buildFingerprint({
        projectPath: '/tmp',
        gitBranch: 'main',
        currentFile: 'src/index.ts',
        recentTools: [],
        recentWings: [],
        recentRooms: [],
      });

      const result = await injector.inject(fp);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.text).toBe('');
      expect(result.value.predictionCount).toBe(0);
    });

    it('should format predictions within token budget', async () => {
      const fp = buildFingerprint({
        projectPath: '/tmp',
        gitBranch: 'main',
        currentFile: 'src/index.ts',
        recentTools: ['claude-code'],
        recentWings: ['project-alpha'],
        recentRooms: [],
      });

      // Train predictor
      for (let i = 0; i < 5; i++) {
        predictor.recordAccess(fp, 'mem-1');
      }

      memories.set('mem-1', makeMemory('mem-1', 'User prefers GraphQL over REST for all new APIs.', 'project-alpha', 'architecture'));

      const result = await injector.inject(fp);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.text.length).toBeGreaterThan(0);
      expect(result.value.text).toContain('omnimind_predictions');
      expect(result.value.text).toContain('GraphQL');
      expect(result.value.tokenEstimate).toBeLessThanOrEqual(150);
    });

    it('should filter by confidence threshold', async () => {
      const fp = buildFingerprint({
        projectPath: '/tmp',
        gitBranch: 'main',
        currentFile: 'src/index.ts',
        recentTools: [],
        recentWings: [],
        recentRooms: [],
      });

      predictor.recordAccess(fp, 'mem-low');
      memories.set('mem-low', makeMemory('mem-low', 'Low confidence memory'));

      // Use high threshold
      const strictInjector = new ContextInjector(
        predictor,
        async (id) => memories.get(id) ?? null,
        { tokenBudget: 150, minConfidence: 0.99 },
      );

      const result = await strictInjector.inject(fp);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.predictionCount).toBe(0);
    });
  });

  describe('formatInjection', () => {
    it('should return empty for empty predictions', async () => {
      const result = await injector.formatInjection([]);
      expect(result.text).toBe('');
      expect(result.predictionCount).toBe(0);
    });

    it('should include memory preview and metadata', async () => {
      memories.set('mem-1', makeMemory('mem-1', 'Use TypeScript strict mode.', 'project-alpha', 'config'));

      const result = await injector.formatInjection([
        { memoryId: 'mem-1', confidence: 0.85, reason: 'accessed 5 times' },
      ]);

      expect(result.text).toContain('project-alpha/config');
      expect(result.text).toContain('TypeScript strict mode');
      expect(result.avgConfidence).toBe(0.85);
    });

    it('should truncate content to 200 chars', async () => {
      const longContent = 'A'.repeat(500);
      memories.set('mem-1', makeMemory('mem-1', longContent));

      const result = await injector.formatInjection([
        { memoryId: 'mem-1', confidence: 0.9, reason: 'test' },
      ]);

      expect(result.text).not.toContain('A'.repeat(250));
    });
  });

  describe('getPredictionsResource', () => {
    it('should return JSON-serializable predictions', async () => {
      const fp = buildFingerprint({
        projectPath: '/tmp',
        gitBranch: 'main',
        currentFile: 'src/index.ts',
        recentTools: [],
        recentWings: [],
        recentRooms: [],
      });

      predictor.recordAccess(fp, 'mem-1');
      memories.set('mem-1', makeMemory('mem-1', 'Test memory', 'wing-a', 'room-b'));

      const result = await injector.getPredictionsResource(fp);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const data = result.value as Record<string, unknown>;
      expect(data.timestamp).toBeDefined();
      expect(Array.isArray(data.predictions)).toBe(true);
      expect(data.stats).toBeDefined();
    });
  });

  describe('getMemoryAwarePrompt', () => {
    it('should return base prompt when no predictions', async () => {
      const fp = buildFingerprint({
        projectPath: '/tmp',
        gitBranch: 'main',
        currentFile: 'src/index.ts',
        recentTools: [],
        recentWings: [],
        recentRooms: [],
      });

      const result = await injector.getMemoryAwarePrompt(fp);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toContain('Omnimind');
    });

    it('should include predictions in prompt when available', async () => {
      const fp = buildFingerprint({
        projectPath: '/tmp',
        gitBranch: 'main',
        currentFile: 'src/index.ts',
        recentTools: [],
        recentWings: [],
        recentRooms: [],
      });

      for (let i = 0; i < 5; i++) {
        predictor.recordAccess(fp, 'mem-1');
      }
      memories.set('mem-1', makeMemory('mem-1', 'Use Vitest for testing.', 'dev', 'tools'));

      const result = await injector.getMemoryAwarePrompt(fp);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toContain('omnimind_predictions');
    });
  });
});
