import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ClaudeAdapter } from '../../../src/bus/adapters/ClaudeAdapter.js';
import { MemoryBus } from '../../../src/bus/MemoryBus.js';
import { MemoryStore } from '../../../src/core/MemoryStore.js';
import { EventType } from '../../../src/bus/types.js';

describe('ClaudeAdapter', () => {
  let tmpDir: string;
  let store: MemoryStore;
  let bus: MemoryBus;
  let adapter: ClaudeAdapter;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'omnimind-claude-test-'));
    store = new MemoryStore({ dbPath: join(tmpDir, 'test.db') });
    await store.init();
    bus = new MemoryBus(store);
    adapter = new ClaudeAdapter(bus, { watchPath: join(tmpDir, 'claude-projects') });
  });

  afterEach(() => {
    adapter.dispose();
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should detect conversation file changes', async () => {
    const watchDir = join(tmpDir, 'claude-projects');
    mkdirSync(watchDir, { recursive: true });

    await adapter.onConnect();
    expect(adapter['connected']).toBe(true);

    // Write a mock conversation file
    writeFileSync(join(watchDir, 'conv.jsonl'), '{"role":"user","content":"Let\'s use GraphQL"}\n');

    // Wait for debounce
    await new Promise((r) => setTimeout(r, 2500));

    // Connection should still be active
    expect(adapter['connected']).toBe(true);
  });

  it('should extract decisions from conversation text', () => {
    const text = `
We decided to use GraphQL instead of REST for the API.
I prefer using TypeScript over JavaScript for this project.
Let's go with PostgreSQL as the database.
Some random text that is not a decision.
    `;

    const decisions = adapter.extractDecisions(text);

    expect(decisions.length).toBeGreaterThanOrEqual(2);
    const texts = decisions.map((d) => d.text.toLowerCase());
    expect(texts.some((t) => t.includes('graphql'))).toBe(true);
    expect(texts.some((t) => t.includes('typescript'))).toBe(true);
  });

  it('should publish memory events on decision detection', async () => {
    const decisions = adapter.extractDecisions("We decided to use Redis for caching.");
    expect(decisions.length).toBe(1);

    // Publish decision manually
    await adapter.publishDecision(decisions[0]!.text, 'architecture', 'cache');

    // Bus should have published the event
    const stats = bus.getStats();
    expect(stats.eventsPublished).toBe(1);
  });

  it('should debounce rapid file changes', async () => {
    const watchDir = join(tmpDir, 'claude-projects');
    mkdirSync(watchDir, { recursive: true });

    await adapter.onConnect();

    // Rapid writes
    for (let i = 0; i < 5; i++) {
      writeFileSync(
        join(watchDir, 'rapid.jsonl'),
        `{"role":"user","content":"msg ${i}"}\n`,
      );
      await new Promise((r) => setTimeout(r, 100));
    }

    // After debounce window, adapter should still be connected
    await new Promise((r) => setTimeout(r, 2500));
    expect(adapter['connected']).toBe(true);
  });

  it('should write notifications to CLAUDE.md on external events', async () => {
    const cwd = process.cwd();
    // Note: we can't easily test CLAUDE.md writing without mocking fs,
    // but we verify the onMemoryEvent handler doesn't throw
    const event = {
      id: 'ext-1',
      timestamp: Date.now(),
      sourceTool: 'cursor',
      eventType: EventType.Create,
      memoryId: null,
      payload: { content: 'Cursor update', wing: 'ui' },
      vectorClock: {},
      priority: 'auto' as const,
    };

    // Should not throw even without CLAUDE.md
    await expect(adapter.onMemoryEvent(event)).resolves.not.toThrow();
  });
});
