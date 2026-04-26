import { describe, it, expect } from 'vitest';
import { ConflictResolver } from '../../src/bus/ConflictResolver.js';
import { createMemoryEvent, EventType, EventPriority } from '../../src/bus/types.js';

describe('ConflictResolver', () => {
  const resolver = new ConflictResolver();

  it('should accept later fact over earlier fact (temporal ordering)', () => {
    const earlier = createMemoryEvent('claude-code', EventType.Create, 'mem-1', {
      content: 'Use REST',
      wing: 'api',
    }, { 'claude-code': 1 });

    const later = createMemoryEvent('claude-code', EventType.Update, 'mem-1', {
      content: 'Use GraphQL',
      wing: 'api',
    }, { 'claude-code': 2 });

    const result = resolver.resolve(earlier, later);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).not.toBeNull();
    expect(result.value!.resolution).toBe('accepted');
    expect(result.value!.action).toBe('supersede');
    expect(result.value!.winningEvent).toBe(later);
  });

  it('should supersede with temporal validity (different validFrom)', () => {
    const old = createMemoryEvent('claude-code', EventType.Create, 'mem-2', {
      content: 'Old approach',
      wing: 'arch',
      validFrom: Date.now() - 86400000,
    });

    const current = createMemoryEvent('cursor', EventType.Create, 'mem-2', {
      content: 'New approach',
      wing: 'arch',
      validFrom: Date.now(),
    });

    const result = resolver.resolve(old, current);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).not.toBeNull();
    expect(result.value!.resolution).toBe('merged');
    expect(result.value!.action).toBe('supersede');
  });

  it('should use tool priority for concurrent events', () => {
    const claude = createMemoryEvent('claude-code', EventType.Create, 'mem-3', {
      content: 'Claude says A',
      wing: 'decision',
    }, { 'claude-code': 5, cursor: 3 });

    const chatgpt = createMemoryEvent('chatgpt', EventType.Create, 'mem-3', {
      content: 'ChatGPT says B',
      wing: 'decision',
    }, { 'claude-code': 3, cursor: 5 });

    const result = resolver.resolve(claude, chatgpt);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).not.toBeNull();
    expect(result.value!.resolution).toBe('accepted');
    expect(result.value!.winningEvent.sourceTool).toBe('claude-code');
  });

  it('should flag equal-priority conflicts for review', () => {
    // Truly concurrent vector clocks (incomparable)
    const cursorA = createMemoryEvent('cursor', EventType.Create, 'mem-4', {
      content: 'Cursor says X',
      wing: 'style',
    }, { cursor: 6, 'claude-code': 5 });

    const claudeA = createMemoryEvent('claude-code', EventType.Create, 'mem-4', {
      content: 'Claude says Y',
      wing: 'style',
    }, { cursor: 5, 'claude-code': 6 });

    const result = resolver.resolve(cursorA, claudeA);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).not.toBeNull();
    expect(result.value!.resolution).toBe('manual_review');
    expect(result.value!.action).toBe('branch');
  });

  it('should always accept user edits over auto-extracted', () => {
    const auto = createMemoryEvent('claude-code', EventType.Create, 'mem-5', {
      content: 'Auto extracted',
      wing: 'pref',
    }, {}, EventPriority.Auto);

    const user = createMemoryEvent('user-edit', EventType.Update, 'mem-5', {
      content: 'User edited',
      wing: 'pref',
    }, {}, EventPriority.User);

    const result = resolver.resolve(auto, user);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).not.toBeNull();
    expect(result.value!.winningEvent.sourceTool).toBe('user-edit');
  });

  it('should return null for different memories', () => {
    const a = createMemoryEvent('claude-code', EventType.Create, 'mem-a', { content: 'A', wing: 'x' });
    const b = createMemoryEvent('cursor', EventType.Create, 'mem-b', { content: 'B', wing: 'x' });

    const result = resolver.resolve(a, b);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toBeNull();
  });
});
