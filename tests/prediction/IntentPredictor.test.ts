/**
 * IntentPredictor unit tests
 *
 * Tests pattern learning, prediction confidence, and formatting.
 */

import { describe, it, expect } from 'vitest';
import { IntentPredictor, buildFingerprint } from '../../src/prediction/IntentPredictor.js';
import type { Memory } from '../../src/core/types.js';
import { MemoryLayer } from '../../src/core/types.js';

function makeMemory(id: string): Memory {
  return {
    id,
    content: `Memory ${id}`,
    contentHash: `hash-${id}`,
    embedding: new Float32Array(384),
    layer: MemoryLayer.Verbatim,
    wing: 'test',
    room: 'default',
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

describe('IntentPredictor', () => {
  describe('recordAccess', () => {
    it('should learn patterns from repeated accesses', () => {
      const predictor = new IntentPredictor();
      const fp = buildFingerprint({
        projectPath: '/home/user/project',
        gitBranch: 'main',
        currentFile: 'src/index.ts',
        recentTools: ['claude-code'],
        recentWings: ['project-alpha'],
        recentRooms: ['architecture'],
      });

      predictor.recordAccess(fp, 'mem-1');
      predictor.recordAccess(fp, 'mem-1');
      predictor.recordAccess(fp, 'mem-1');

      const stats = predictor.getStats();
      expect(stats.totalPatterns).toBe(1);
      expect(stats.uniqueContexts).toBe(1);
    });
  });

  describe('predict', () => {
    it('should return empty when no patterns exist', async () => {
      const predictor = new IntentPredictor();
      const fp = buildFingerprint({
        projectPath: '/home/user/project',
        gitBranch: 'main',
        currentFile: 'src/index.ts',
        recentTools: [],
        recentWings: [],
        recentRooms: [],
      });

      const result = await predictor.predict(fp, async () => null);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBe(0);
    });

    it('should predict memories above confidence threshold', async () => {
      const predictor = new IntentPredictor({ confidenceThreshold: 0.3 });
      const fp = buildFingerprint({
        projectPath: '/home/user/project',
        gitBranch: 'main',
        currentFile: 'src/index.ts',
        recentTools: ['claude-code'],
        recentWings: ['project-alpha'],
        recentRooms: ['architecture'],
      });

      // Record 5 accesses to boost confidence
      for (let i = 0; i < 5; i++) {
        predictor.recordAccess(fp, 'mem-alpha');
      }

      const result = await predictor.predict(fp, async (id) =>
        id === 'mem-alpha' ? makeMemory(id) : null,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBeGreaterThan(0);
      expect(result.value[0]!.memoryId).toBe('mem-alpha');
      expect(result.value[0]!.confidence).toBeGreaterThanOrEqual(0.3);
    });

    it('should respect maxPredictions limit', async () => {
      const predictor = new IntentPredictor({ confidenceThreshold: 0.1, maxPredictions: 2 });
      const fp = buildFingerprint({
        projectPath: '/home/user/project',
        gitBranch: 'main',
        currentFile: 'src/index.ts',
        recentTools: [],
        recentWings: [],
        recentRooms: [],
      });

      predictor.recordAccess(fp, 'mem-1');
      predictor.recordAccess(fp, 'mem-2');
      predictor.recordAccess(fp, 'mem-3');

      const result = await predictor.predict(fp, async (id) => makeMemory(id));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBeLessThanOrEqual(2);
    });
  });

  describe('formatPredictions', () => {
    it('should return empty string for no predictions', async () => {
      const predictor = new IntentPredictor();
      const result = await predictor.formatPredictions([], async () => null);
      expect(result).toBe('');
    });

    it('should format predictions within token budget', async () => {
      const predictor = new IntentPredictor();
      const predictions = [
        { memoryId: 'mem-1', confidence: 0.85, reason: 'test' },
      ];

      const result = await predictor.formatPredictions(predictions, async (id) =>
        id === 'mem-1'
          ? { ...makeMemory(id), content: 'This is a moderately long memory content that should be truncated if it exceeds the token budget for context injection.' }
          : null,
      );

      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain('omnimind_predictions');
      expect(result).toContain('test/default');
    });
  });

  describe('buildFingerprint', () => {
    it('should produce deterministic hashes for same inputs', () => {
      const fp1 = buildFingerprint({
        projectPath: '/home/user/project',
        gitBranch: 'main',
        currentFile: 'src/index.ts',
        recentTools: ['claude-code'],
        recentWings: ['alpha'],
        recentRooms: ['arch'],
      });
      const fp2 = buildFingerprint({
        projectPath: '/home/user/project',
        gitBranch: 'main',
        currentFile: 'src/index.ts',
        recentTools: ['claude-code'],
        recentWings: ['alpha'],
        recentRooms: ['arch'],
      });

      expect(fp1.projectHash).toBe(fp2.projectHash);
      expect(fp1.branchHash).toBe(fp2.branchHash);
      expect(fp1.fileExtension).toBe('ts');
    });

    it('should differentiate different projects', () => {
      const fp1 = buildFingerprint({
        projectPath: '/home/user/project-a',
        gitBranch: 'main',
        currentFile: 'src/index.ts',
        recentTools: [],
        recentWings: [],
        recentRooms: [],
      });
      const fp2 = buildFingerprint({
        projectPath: '/home/user/project-b',
        gitBranch: 'main',
        currentFile: 'src/index.ts',
        recentTools: [],
        recentWings: [],
        recentRooms: [],
      });

      expect(fp1.projectHash).not.toBe(fp2.projectHash);
    });
  });
});
